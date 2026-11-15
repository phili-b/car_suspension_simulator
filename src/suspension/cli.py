"""Command line entry point: `uv run suspension`."""

import threading
import webbrowser

import typer
import uvicorn

app = typer.Typer(add_completion=False)


@app.command()
def main(
    host: str = typer.Option("127.0.0.1", help="0.0.0.0 = reachable from other machines."),
    port: int = 8000,
    browser: bool = True,
) -> None:
    """Start the suspension explorer and open it in the browser."""
    url = f"http://{'127.0.0.1' if host == '0.0.0.0' else host}:{port}"
    typer.echo(f"Suspension explorer on {url}  (Ctrl+C to stop)")
    if browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    uvicorn.run("suspension.server:app", host=host, port=port, log_level="warning")
