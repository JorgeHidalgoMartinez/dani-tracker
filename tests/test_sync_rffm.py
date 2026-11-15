import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from sync_rffm import extract_page_props, convert_data, norm, iso_date, RffmDataError


class SnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline = json.loads((ROOT / 'tests' / 'fixtures' / 'historical.json').read_text(encoding='utf-8'))
        cls.names = [t['name'] for t in cls.baseline['teams']]
        cls.ids = {name: str(100 + i) for i, name in enumerate(cls.names)}
        cls.rivas = next(name for name in cls.names if norm(name) == 'RIVAS FUTBOL CLUB C')
        cls.standings = {'standings': {'clasificacion': [
            {'nombre': t['name'], 'codequipo': cls.ids[t['name']],
             'posicion': t['pos'], 'puntos': t['pts'], 'jugados': t['pj'],
             'ganados': t['pg'], 'empatados': t['pe'], 'perdidos': t['pp'],
             'goles_a_favor': t['gf'], 'goles_en_contra': t['gc']}
            for t in cls.baseline['teams']]}}
        cls.calendar = {'calendar': {'rounds': []}}
        # Artificial 306-match dataset for parser tests; NOT an official dataset.
        # One Rivas fixture based on the verified historical snapshot per round,
        # plus eight generated blank fixtures involving the other sixteen teams.
        for f in cls.baseline['fixtures']:
            rival = next(n for n in cls.names if norm(n) == norm(f['rival']))
            local = cls.rivas if f['home'] else rival
            away = rival if f['home'] else cls.rivas
            raw = []
            def match(h, a, gf='', gc='', date='15/11/2026'):
                return {'equipo_local': h, 'equipo_visitante': a,
                        'codigo_equipo_local': cls.ids[h],
                        'codigo_equipo_visitante': cls.ids[a],
                        'goles_casa': gf, 'goles_visitante': gc,
                        'fecha': date, 'hora': '17:00'}
            raw.append(match(local, away,
                (f['gf'] if f['home'] else f['gc']) if f['gf'] is not None else '',
                (f['gc'] if f['home'] else f['gf']) if f['gc'] is not None else '',
                f['date']))
            others = [n for n in cls.names if n not in (cls.rivas,rival)]
            for i in range(0,16,2):
                raw.append(match(others[i],others[i+1]))
            cls.calendar['calendar']['rounds'].append({'jornada': f'Jornada {f["j"]}', 'equipos': raw})

    def test_next_data(self):
        html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"calendar":{}}}}</script>'
        self.assertIn('calendar', extract_page_props(html))

    def test_normalize_date(self):
        self.assertEqual(norm("RIVAS FÚTBOL CLUB 'C'"), 'RIVAS FUTBOL CLUB C')
        self.assertEqual(iso_date('14/11/2026'), '2026-11-14')

    def test_valid_dataset(self):
        result = convert_data(self.calendar, self.standings, self.baseline, '2026-11-15T12:00:00Z')
        self.assertEqual(len(result['fixtures']),34)
        self.assertEqual(len(result['league_matches']),306)
        self.assertEqual(result['data_through_jornada'],9)
        self.assertEqual(result['fixtures'][0]['gf'],0)
        self.assertIsNone(result['fixtures'][9]['gf'])

    def test_missing_score_rejected(self):
        altered=copy.deepcopy(self.calendar)
        altered['calendar']['rounds'][0]['equipos'][0]['goles_casa']=''
        altered['calendar']['rounds'][0]['equipos'][0]['goles_visitante']=''
        with self.assertRaisesRegex(RffmDataError,'marcador confirmado'):
            convert_data(altered,self.standings,self.baseline,'2026-11-15T12:00:00Z')

    def test_conflicting_score_rejected(self):
        altered=copy.deepcopy(self.calendar)
        altered['calendar']['rounds'][0]['equipos'][0]['goles_casa']='4'
        with self.assertRaisesRegex(RffmDataError,'Corrección de marcador'):
            convert_data(altered,self.standings,self.baseline,'2026-11-15T12:00:00Z')

    def test_incomplete_table_rejected(self):
        altered=copy.deepcopy(self.standings)
        altered['standings']['clasificacion'].pop()
        with self.assertRaises(RffmDataError):
            convert_data(self.calendar,altered,self.baseline,'2026-11-15T12:00:00Z')

    def test_missing_calendar_rejected(self):
        with self.assertRaises(RffmDataError):
            convert_data({'calendar': {'rounds': []}},self.standings,self.baseline,'2026-11-15T12:00:00Z')


if __name__ == '__main__':
    unittest.main()
