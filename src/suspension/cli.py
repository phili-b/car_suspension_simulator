"""Command line entry point: `uv run suspension`."""

import threading
import webbrowser

import typer
import uvicorn

app = typer.Typer(add_completion=False)


@app.command()
def main(port: int = 8000, browser: bool = True) -> None:
    """Start the suspension explorer and open it in the browser."""
    url = f"http://127.0.0.1:{port}"
    typer.echo(f"Suspension explorer on {url}  (Ctrl+C to stop)")
    if browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    uvicorn.run("suspension.server:app", host="127.0.0.1", port=port, log_level="warning")
