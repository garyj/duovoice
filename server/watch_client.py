"""Watch server/ and regenerate the typed frontend client on change.

The watchfiles CLI kills and restarts the command when new events arrive,
which can interrupt openapi-ts mid-write and corrupt the generated client.
This uses watchfiles as a library instead: `watch()` is a blocking generator,
so each regeneration runs to completion, and events that arrive during a run
are delivered as a single batch on the next loop iteration.
"""

import subprocess

from watchfiles import PythonFilter, watch


def main() -> None:
    print(
        "watching server/ — regenerating client on change (Ctrl-C to stop)", flush=True
    )
    for changes in watch("server", watch_filter=PythonFilter()):
        names = ", ".join(sorted({path.rsplit("/", 1)[-1] for _, path in changes}))
        print(f"changed: {names} → just client", flush=True)
        subprocess.run(["just", "client"], check=False)


if __name__ == "__main__":
    main()
