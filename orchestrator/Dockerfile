# Dockerfile for the IDK-AI orchestrator service
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install orchestrator-specific dependencies
COPY orchestrator/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Copy shared configuration utilities
COPY config_loader.py ./config_loader.py
COPY config.ini ./config.ini
COPY config.ini.example ./config.ini.example
# Create optional override file placeholder so Config loader can source overrides without failing
RUN touch config.local.ini

# Copy orchestrator package
COPY orchestrator/ ./orchestrator/

EXPOSE 8000

CMD ["python", "-m", "orchestrator.main"]
