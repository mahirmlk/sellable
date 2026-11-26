# Python dependency locks

`runtime.txt` is the production dependency lock compiled from `pyproject.toml`
and the `postgres` extra. `dev.txt` is a hash-locked development overlay
compiled from `dev.in` against that runtime lock. CI installs both files in one
pip invocation; the Cloudflare Container installs only `runtime.txt`.

Refresh locks with Python 3.11 and pip-tools 7.7.0 so package markers are
resolved against the oldest supported runtime:

```bash
python -m pip install pip-tools==7.7.0
python -m piptools compile --resolver=backtracking --extra=postgres \
  --generate-hashes --allow-unsafe --output-file=requirements/runtime.txt \
  pyproject.toml
python -m piptools compile --resolver=backtracking --generate-hashes \
  --allow-unsafe --output-file=requirements/dev.txt requirements/dev.in
```

Review the generated diff and run CI on Python 3.11 and 3.12 before merging.
Install with `python -m pip install --require-hashes -r
requirements/runtime.txt -r requirements/dev.txt`; do not add unhashed direct
installs to production images.
