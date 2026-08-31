FROM python:3.11-slim

WORKDIR /app

COPY services/ services/
COPY agents/ agents/
COPY infra/seed/ infra/seed/
COPY pyproject.toml .

RUN pip install --no-cache-dir .

RUN mkdir -p data && \
    useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "-m", "uvicorn", "sellable.main:app", "--host", "0.0.0.0", "--port", "8000"]
