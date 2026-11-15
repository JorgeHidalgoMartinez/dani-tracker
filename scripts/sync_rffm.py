#!/usr/bin/env python3
"""Conservative public RFFM group snapshot collector for Dani Tracker.

Only reads calendar and standings. Does not request player profiles,
match reports, team profiles, or any restricted routes. Fails closed on
robots.txt and invalid/ambiguous data. Intended for twice-daily CI.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import re
from pathlib import Path
import sys
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

BASE = 'https://www.rffm.es'
SEASON, GAME_TYPE, COMPETITION, GROUP = 22, 1, 26737724, 26737733
UA = 'DaniTracker/0.3 (+https://github.com/JorgeHidalgoMartinez/dani-tracker; twice daily)'
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'snapshot.json'
PAGES = {
    'calendario': '/competicion/calendario',
    'clasificaciones': '/competicion/clasificaciones',
}
PARAMS = {'temporada': SEASON, 'tipojuego': GAME_TYPE,
          'competicion': COMPETITION, 'grupo': GROUP}


class RffmDataError(Exception):
    pass


class NextDataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.found = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('id') == '__NEXT_DATA__':
            self.inside = True

    def handle_endtag(self, tag):
        if tag == 'script':
            self.inside = False

    def handle_data(self, text):
        if self.inside:
            self.found.append(text)


def extract_page_props(html):
    parser = NextDataParser()
    parser.feed(html)
    if not parser.found:
        raise RffmDataError('No se ha encontrado __NEXT_DATA__ (posible cambio de la web).')
    try:
        obj = json.loads(''.join(parser.found))
        props = obj['props']['pageProps']
    except (ValueError, KeyError, TypeError) as exc:
        raise RffmDataError('Estructura de __NEXT_DATA__ no reconocida.') from exc
    if not isinstance(props, dict):
        raise RffmDataError('pageProps no es un objeto JSON.')
    return props


def norm(text):
    text = unicodedata.normalize('NFKD', str(text or ''))
    text = ''.join(c for c in text if not unicodedata.combining(c))
    return ' '.join(re.findall(r'[A-Z0-9]+', text.upper()))


def as_int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    t = str(v or '').strip()
    if re.fullmatch(r'\d+', t):
        return int(t)
    return None


def iso_date(v):
    s = str(v or '').strip()
    if not s:
        return None
    for fmt in ('%d/%m/%Y', '%d-%m-%Y', '%Y-%m-%d', '%Y/%m/%d', '%d/%m/%y'):
        try:
            return datetime.strptime(s[:10], fmt).date().isoformat()
        except ValueError:
            continue
    raise RffmDataError(f'Fecha no reconocida: {s!r}')


def get_round(v):
    m = re.search(r'\b(\d{1,2})\b', str(v or ''))
    return int(m.group(1)) if m else None


def get_text(row, key):
    return str(row.get(key) or '').strip()


def convert_data(cal_props, standings_props, previous, checked_at):
    cal = cal_props.get('calendar')
    std = standings_props.get('standings')
    if not isinstance(cal, dict) or not isinstance(std, dict):
        raise RffmDataError('Faltan calendar o standings de la federación.')
    raw_teams = std.get('clasificacion')
    rounds = cal.get('rounds')
    if not isinstance(raw_teams, list) or not isinstance(rounds, list):
        raise RffmDataError('Clasificación o jornadas ausentes.')
    if len(raw_teams) != 18 or len(rounds) < 34:
        raise RffmDataError(f'Cobertura inesperada: {len(raw_teams)} equipos y {len(rounds)} jornadas.')
    teams = []
    for row in raw_teams:
        name = get_text(row, 'nombre')
        code = get_text(row, 'codequipo')
        nums = {k: as_int(row.get(src)) for k, src in (
            ('pos', 'posicion'), ('pts', 'puntos'), ('pj', 'jugados'),
            ('pg', 'ganados'), ('pe', 'empatados'), ('pp', 'perdidos'),
            ('gf', 'goles_a_favor'), ('gc', 'goles_en_contra'))}
        if not name or not code or any(v is None or v < 0 for v in nums.values()):
            raise RffmDataError(f'Fila de clasificación incompleta: {name!r}')
        if nums['pj'] != nums['pg'] + nums['pe'] + nums['pp'] or nums['pj'] > 34:
            raise RffmDataError(f'Balance incoherente en {name}.')
        teams.append({'id': code, 'name': name, **nums})
    if len({t['id'] for t in teams}) != 18:
        raise RffmDataError('IDs de equipo duplicados en la tabla.')
    if sorted(t['pos'] for t in teams) != list(range(1, 19)):
        raise RffmDataError('Posiciones de clasificación duplicadas o fuera de rango.')
    if sum(t['gf'] for t in teams) != sum(t['gc'] for t in teams):
        raise RffmDataError('Goles globales de clasificación incoherentes.')
    rivas = [t for t in teams if norm(t['name']) == 'RIVAS FUTBOL CLUB C']
    if len(rivas) != 1:
        raise RffmDataError(f'No se ha identificado con seguridad el Rivas C ({len(rivas)} coincidencias).')
    own = rivas[0]
    team_by_id = {t['id']: t for t in teams}
    team_by_norm = {norm(t['name']): t for t in teams}

    def match_team(raw_id, raw_name):
        raw_id = str(raw_id or '').strip()
        if raw_id in team_by_id:
            return team_by_id[raw_id]
        return team_by_norm.get(norm(raw_name))

    league_matches = []
    fixtures = []
    seen = set()
    for round_obj in rounds:
        j = get_round(round_obj.get('jornada'))
        if j is None or not (1 <= j <= 34):
            raise RffmDataError('Jornada inesperada en calendario.')
        for row in round_obj.get('equipos', []):
            home_name = get_text(row, 'equipo_local')
            away_name = get_text(row, 'equipo_visitante')
            home = match_team(row.get('codigo_equipo_local'), home_name)
            away = match_team(row.get('codigo_equipo_visitante'), away_name)
            if not home or not away or home['id'] == away['id']:
                raise RffmDataError(f'Equipos no reconocidos en jornada {j}: {home_name} / {away_name}')
            key = (j, home['id'], away['id'])
            if key in seen:
                raise RffmDataError(f'Partido duplicado en jornada {j}.')
            seen.add(key)
            gf = as_int(row.get('goles_casa'))
            gc = as_int(row.get('goles_visitante'))
            if (gf is None) != (gc is None):
                raise RffmDataError(f'Marcador incompleto en jornada {j}.')
            if any(n is not None and n > 60 for n in (gf, gc)):
                raise RffmDataError('Marcador imposible (>60).')
            date = iso_date(row.get('fecha'))
            tm = get_text(row, 'hora') or None
            if tm and not re.fullmatch(r'(?:[01]?\d|2[0-3]):[0-5]\d(?:h)?', tm):
                tm = None
            venue = get_text(row, 'campo') or None
            league_matches.append({'j': j, 'date': date, 'time': tm,
                'home': home['name'], 'away': away['name'],
                'home_id': home['id'], 'away_id': away['id'],
                'hg': gf, 'ag': gc, 'venue': venue})
            if home['id'] == own['id'] or away['id'] == own['id']:
                is_home = home['id'] == own['id']
                rival = away if is_home else home
                fixtures.append({'j': j, 'date': date, 'time': tm,
                    'rival': rival['name'], 'rival_id': rival['id'],
                    'home': is_home, 'gf': gf if is_home else gc,
                    'gc': gc if is_home else gf, 'venue': venue})
    fixtures.sort(key=lambda x: x['j'])
    league_matches.sort(key=lambda x: (x['j'], x['home_id']))
    if len(fixtures) != 34 or len({f['j'] for f in fixtures}) != 34:
        raise RffmDataError(f'Calendario del Rivas incompleto: {len(fixtures)} partidos únicos.')
    if len(league_matches) != 306:
        raise RffmDataError(f'Calendario de liga incompleto: {len(league_matches)} de 306 partidos.')
    for j in range(1, 35):
        games = [m for m in league_matches if m['j'] == j]
        ids = [v for m in games for v in (m['home_id'], m['away_id'])]
        if len(games) != 9 or len(set(ids)) != 18:
            raise RffmDataError(f'Emparejamientos incoherentes en jornada {j}.')
    finished = sum(f['gf'] is not None for f in fixtures)
    prev_fixture = {int(f['j']): f for f in previous.get('fixtures', [])}
    for f in fixtures:
        before = prev_fixture.get(f['j'])
        if before and before.get('gf') is not None:
            if norm(before.get('rival')) != norm(f['rival']) or before.get('home') != f['home']:
                raise RffmDataError(f'Identidad de partido modificada en J{f["j"]}.')
            if f['gf'] is None or f['gc'] is None:
                raise RffmDataError(f'Un marcador confirmado ha desaparecido (J{f["j"]}).')
            if (int(before['gf']), int(before['gc'])) != (f['gf'], f['gc']):
                raise RffmDataError(f'Corrección de marcador J{f["j"]}; revisar manualmente antes de publicar.')
    if abs(finished - own['pj']) > 1:
        raise RffmDataError('Resultados del Rivas y PJ de clasificación no concuerdan.')
    old_games = {(m['j'], norm(m['home']), norm(m['away'])): m
                 for m in previous.get('league_matches', []) if m.get('hg') is not None}
    current = {(m['j'], norm(m['home']), norm(m['away'])): m for m in league_matches}
    for key, before in old_games.items():
        after = current.get(key)
        if not after or (before['hg'], before['ag']) != (after['hg'], after['ag']):
            raise RffmDataError('Ha desaparecido o cambiado un resultado confirmado del grupo; revisión manual necesaria.')
    confirmed_dates = [f['date'] for f in fixtures if f['gf'] is not None and f['date']]
    date_max = max(confirmed_dates) if confirmed_dates else previous.get('as_of')
    old_sources = previous.get('sources', [])
    return {
        'scope': 'Primera Juvenil Grupo 9 2026/27; Rivas Fútbol Club C',
        'as_of': date_max,
        'checked_at': checked_at,
        'data_through_jornada': max((f['j'] for f in fixtures if f['gf'] is not None), default=0),
        'sync_mode': 'rffm_calendar_and_standings',
        'status': 'Datos agregados del calendario y clasificación de la RFFM; sin información individual automática.',
        'consistency_note': (f'La tabla indica {own["pj"]} partidos jugados, pero el calendario ofrece {finished} marcadores. Se muestran por separado, sin completar el dato ausente.' if finished != own['pj'] else ''),
        'official': {'season_id': SEASON, 'game_type_id': GAME_TYPE,
                     'competition_id': COMPETITION, 'group_id': GROUP,
                     'rivas_team_id': own['id']},
        'teams': teams, 'fixtures': fixtures, 'league_matches': league_matches,
        'sources': old_sources,
    }


def fetch_public(robots, page_name):
    params = dict(PARAMS)
    if page_name == 'calendario':
        params['jornada'] = 1
    url = f'{BASE}{PAGES[page_name]}?{urlencode(params)}'
    if not robots.can_fetch(UA, url):
        raise RffmDataError(f'Acceso no permitido por robots.txt: {page_name}.')
    request = Request(url, headers={'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml;q=0.9'})
    with urlopen(request, timeout=25) as response:
        if response.status != 200:
            raise RffmDataError(f'HTTP {response.status} al consultar {page_name}')
        html = response.read(4_000_000).decode('utf-8', errors='replace')
    return extract_page_props(html)


def run():
    old = json.loads(DEST.read_text(encoding='utf-8'))
    robots = RobotFileParser(BASE + '/robots.txt')
    # Explicit timeout and 200 requirement: robots.read() has no timeout.
    with urlopen(Request(BASE + '/robots.txt', headers={'User-Agent': UA}), timeout=25) as response:
        if response.status != 200:
            raise RffmDataError('No se ha podido verificar robots.txt; actualización cancelada.')
        robots.parse(response.read(100_000).decode('utf-8').splitlines())
    cal = fetch_public(robots, 'calendario')
    time.sleep(3)
    std = fetch_public(robots, 'clasificaciones')
    updated = convert_data(cal, std, old,
        datetime.now(timezone.utc).isoformat(timespec='seconds'))
    # Keep successful check time separate from the date of the sporting results.
    tmp = DEST.with_suffix('.tmp')
    tmp.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(DEST)
    (ROOT / 'assets' / 'fallback_snapshot.js').write_text(
        'window.DANI_BUNDLED_SNAPSHOT = ' + json.dumps(updated, ensure_ascii=False) + ';\n', encoding='utf-8')
    print(f'Actualizado: {updated["data_through_jornada"]} jornadas con marcador; {len(updated["league_matches"])} partidos de liga.')


def main():
    checked = datetime.now(timezone.utc).isoformat(timespec='seconds')
    try:
        run()
        state = {'attempted_at': checked, 'ok': True,
                 'message': 'Consulta de calendario y clasificación completada.'}
        code = 0
    except (RffmDataError, HTTPError, URLError, TimeoutError, OSError, KeyError, ValueError, TypeError) as exc:
        print(f'ACTUALIZACIÓN CANCELADA: {exc}', file=sys.stderr)
        state = {'attempted_at': checked, 'ok': False,
                 'message': 'La consulta o validación falló. Se conserva la última copia correcta. Revisa el registro de GitHub Actions.'}
        code = 1
    status_path = DEST.parent / 'sync_status.json'
    temp = status_path.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(status_path)
    return code


if __name__ == '__main__':
    sys.exit(main())
