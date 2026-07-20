"""Write the OpenAPI schema to frontend/openapi.json for client generation."""

import json
from pathlib import Path

from server.main import app

out = Path(__file__).resolve().parent.parent / "frontend" / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2) + "\n")
print(f"wrote {out}")
