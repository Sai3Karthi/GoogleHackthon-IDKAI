# Dockerfile for Module 1 backend service
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY module1/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY . /app

WORKDIR /app/module1/backend

EXPOSE 8001

CMD ["python", "main.py"]
