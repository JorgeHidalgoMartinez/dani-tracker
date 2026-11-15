"""Wait for Pages to serve this checkout's public JSON, then test the live UI."""
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from browser_smoke import check
BASE='https://jorgehidalgomartinez.github.io/dani-tracker/'
expected={p:json.loads((ROOT/'data'/p).read_text()) for p in ('snapshot.json','sync_status.json')}
for attempt in range(18):
    try:
        same=True
        for name,data in expected.items():
            url=BASE+'data/'+name+'?verification='+str(time.time_ns())
            with urlopen(Request(url,headers={'Cache-Control':'no-cache'}),timeout=20) as response:
                same=same and json.load(response)==data
    except Exception as exc:
        same=False
        print('Publicación aún pendiente:',type(exc).__name__)
    if same:
        print('Pages sirve exactamente el snapshot y el estado de este checkout.')
        check(BASE)
        break
    time.sleep(10)
else:
    raise SystemExit('Pages no ha servido la copia esperada dentro del plazo; revisar despliegue.')
