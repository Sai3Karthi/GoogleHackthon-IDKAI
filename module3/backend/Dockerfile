# Dockerfile for Module 3 backend service
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY module3/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY . /app

WORKDIR /app/module3/backend

EXPOSE 8003

CMD ["python", "main.py"]
