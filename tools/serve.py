"""Local Bloom preview with explicit JavaScript-module and WebAssembly MIME types."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
import argparse
ROOT=Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.glb':'model/gltf-binary','.task':'application/octet-stream'}
    def end_headers(self):
        if self.path.split('?')[0].endswith(('.html','.js','.mjs','.css')) or self.path.split('?')[0]=='/':self.send_header('Cache-Control','no-cache')
        super().end_headers()
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(ROOT)))
    print('Bloom: http://localhost:'+str(args.port),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
