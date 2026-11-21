FROM python:3.11-slim

WORKDIR /app

COPY services/ services/
COPY agents/ agents/
COPY infra/seed/ infra/seed/
COPY pyproject.toml .

RUN pip install --no-cache-dir ".[postgres]"

RUN mkdir -p data && \
    useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/ready' % os.getenv('PORT', '8000'), timeout=4)" || exit 1

CMD ["python", "-m", "sellable.serve"]
