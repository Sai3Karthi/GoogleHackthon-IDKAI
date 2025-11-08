# Dockerfile for Module 4 backend service
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY module4/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY . /app

WORKDIR /app/module4/backend

EXPOSE 8004

CMD ["python", "main.py"]
