# Dockerfile for Module 2 backend service
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY Module2/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY . /app

WORKDIR /app/Module2/backend

EXPOSE 8002

CMD ["python", "main.py"]
