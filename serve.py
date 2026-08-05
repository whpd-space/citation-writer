#!/usr/bin/env python3
"""No-cache local server with GitHub Pages-style 404 route handling."""

import io
from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Serve files and emulate GitHub Pages for extensionless app routes."""

    def serve_404_page(self):
        fallback_path = Path(self.directory) / "404.html"
        if not fallback_path.is_file():
            return super().send_error(404)

        content = fallback_path.read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        return io.BytesIO(content)

    def send_head(self):
        request_path = unquote(urlparse(self.path).path)
        fs_path = Path(self.directory) / request_path.lstrip("/")

        if fs_path.is_file():
            return super().send_head()

        if fs_path.is_dir():
            if (fs_path / "index.html").is_file():
                return super().send_head()
            return self.serve_404_page()

        route_name = Path(request_path.rstrip("/")).name
        if "." not in route_name:
            return self.serve_404_page()

        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


def main():
    parser = ArgumentParser(description="Serve WHPD Citation Writer locally")
    parser.add_argument("--port", type=int, default=39614)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = lambda *handler_args, **kwargs: NoCacheHandler(  # noqa: E731
        *handler_args, directory=str(root), **kwargs
    )
    server = ThreadingHTTPServer(("localhost", args.port), handler)
    print(f"WHPD Citation Writer: http://localhost:{args.port}")
    print("GitHub Pages-style 404 route handling is enabled.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
