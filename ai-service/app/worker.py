"""SQS worker: optimize jobs in, results out. Scale by running more ai-service tasks on queue depth."""

import json
import logging
import os
import threading

import boto3

from app import claude
from app.optimizer import Constraints, optimize

log = logging.getLogger(__name__)
JOBS = os.environ.get("OPTIMIZE_JOBS_QUEUE", "optimize-jobs")
RESULTS = os.environ.get("OPTIMIZE_RESULTS_QUEUE", "optimize-results")


def sqs_client():
    return boto3.client("sqs", endpoint_url=os.environ.get("SQS_ENDPOINT"), region_name=os.environ.get("AWS_REGION", "us-east-1"))


def queue_url(sqs, name: str) -> str:
    # Idempotent: returns the existing queue. In AWS the queues come from Terraform and this is a lookup.
    return sqs.create_queue(QueueName=name)["QueueUrl"]


def handle(job: dict) -> dict:
    constraints = claude.parse_constraints(job.get("instructions"), job)
    result = optimize(job, constraints or Constraints())
    result.update(claude.explain(job, result))
    result["constraintsUnderstood"] = constraints is not None
    return result


def process_once(sqs, jobs_url: str, results_url: str, wait_seconds: int = 10) -> int:
    msgs = sqs.receive_message(QueueUrl=jobs_url, MaxNumberOfMessages=5, WaitTimeSeconds=wait_seconds).get("Messages", [])
    for m in msgs:
        job = json.loads(m["Body"])
        try:
            out = {"previewId": job["previewId"], "status": "READY", "result": handle(job)}
        except Exception:  # one bad job must not stop the worker; core-api shows the failure
            log.exception("optimize job %s failed", job.get("previewId"))
            out = {"previewId": job.get("previewId"), "status": "FAILED", "error": "The optimizer couldn't build a plan."}
        sqs.send_message(QueueUrl=results_url, MessageBody=json.dumps(out))
        sqs.delete_message(QueueUrl=jobs_url, ReceiptHandle=m["ReceiptHandle"])
    return len(msgs)


def start(stop: threading.Event) -> threading.Thread:
    sqs = sqs_client()
    jobs_url, results_url = queue_url(sqs, JOBS), queue_url(sqs, RESULTS)

    def loop():
        while not stop.is_set():
            try:
                process_once(sqs, jobs_url, results_url)
            except Exception:
                log.exception("queue poll failed; retrying")
                stop.wait(5)

    t = threading.Thread(target=loop, name="optimize-worker", daemon=True)
    t.start()
    return t
