"""Order emails are limited to creation and pickup readiness."""
import pytest
from ordering.lifecycle.order_mail import enqueue_progress


class RecordingCursor:
    def __init__(self):
        self.arrCalls = []

    def execute(self, strSql, arrValues):
        self.arrCalls.append((strSql, arrValues))


@pytest.mark.parametrize('strStatus', ['order_received', 'order_confirmed', 'preparing_order', 'cooking_order', 'estimate', 'completed', 'unknown'])
def test_quiet_statuses_do_not_enqueue_mail(strStatus):
    objCursor = RecordingCursor()
    # No order fields or environment are needed for a deliberately silent update.
    enqueue_progress(objCursor, {}, strStatus)
    assert objCursor.arrCalls == []


def test_ready_notice_contains_tracker_and_correct_recipient(monkeypatch):
    monkeypatch.setenv('SITE_URL', 'https://pizza.example')
    objCursor = RecordingCursor()
    enqueue_progress(objCursor, {'id': 7, 'tracking_token': 'test-token', 'customer_email': 'customer@example.invalid'}, 'order_ready')
    assert len(objCursor.arrCalls) == 1
    _, arrValues = objCursor.arrCalls[0]
    assert arrValues[1] == 'customer@example.invalid'
    assert 'ready for pickup' in arrValues[2]
    assert 'https://pizza.example/track?token=test-token' in arrValues[3]
