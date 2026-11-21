# Mantel for Home Assistant

The integration itself lives at `custom_components/mantel/` in the repository root, where HACS
looks for it. This folder holds its tests and notes. Setup and entities: `docs/open.md`.

Run the tests (they start a Mantel mock server, so build it first):

```sh
pnpm --filter "@mantel/server..." build
python -m venv .venv && .venv/bin/pip install -r integrations/home-assistant/requirements-test.txt
cd integrations/home-assistant && ../../.venv/bin/python -m pytest -q
```
