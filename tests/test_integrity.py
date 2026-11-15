import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import sync_rffm as sync
import test_sync_rffm as fixtures

class IntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): fixtures.SnapshotTests.setUpClass()

    def test_duplicate_standing_position_rejected(self):
        std=copy.deepcopy(fixtures.SnapshotTests.standings)
        std['standings']['clasificacion'][1]['posicion']=std['standings']['clasificacion'][0]['posicion']
        with self.assertRaisesRegex(sync.RffmDataError,'Posiciones'):
            sync.convert_data(fixtures.SnapshotTests.calendar,std,fixtures.SnapshotTests.baseline,'test')

    def test_same_team_twice_in_round_rejected(self):
        cal=copy.deepcopy(fixtures.SnapshotTests.calendar)
        rows=cal['calendar']['rounds'][0]['equipos']
        rows[1]['codigo_equipo_local']=rows[0]['codigo_equipo_local']
        with self.assertRaises(sync.RffmDataError):
            sync.convert_data(cal,fixtures.SnapshotTests.standings,fixtures.SnapshotTests.baseline,'test')

    def test_confirmed_group_result_not_erased(self):
        prior=sync.convert_data(fixtures.SnapshotTests.calendar,fixtures.SnapshotTests.standings,fixtures.SnapshotTests.baseline,'test')
        m=next(m for m in prior['league_matches'] if m['hg'] is None)
        m['hg'],m['ag']=1,0
        with self.assertRaisesRegex(sync.RffmDataError,'resultado confirmado del grupo'):
            sync.convert_data(fixtures.SnapshotTests.calendar,fixtures.SnapshotTests.standings,prior,'test')

    def test_failure_keeps_snapshot_and_records_failed_attempt(self):
        with tempfile.TemporaryDirectory() as folder:
            dest=Path(folder)/'snapshot.json';dest.write_text('{"previous":"valid"}')
            with patch.object(sync,'DEST',dest),patch.object(sync,'run',side_effect=sync.RffmDataError('Fuente indisponible')):
                self.assertEqual(sync.main(),1)
            self.assertEqual(dest.read_text(),'{"previous":"valid"}')
            self.assertFalse(json.loads((dest.parent/'sync_status.json').read_text())['ok'])

    def test_network_timeout_does_not_write_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            dest=Path(folder)/'snapshot.json';dest.write_text('{"fixtures":[]}')
            with patch.object(sync,'DEST',dest),patch.object(sync,'urlopen',side_effect=TimeoutError('timeout')):
                with self.assertRaises(TimeoutError):sync.run()
            self.assertEqual(dest.read_text(),'{"fixtures":[]}')

if __name__=='__main__':unittest.main()
