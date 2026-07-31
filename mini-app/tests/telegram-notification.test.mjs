import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeTelegramMarkdownText,
  notificationCopyForAlert,
  notificationDisplaySeverityForAlert,
  notificationSeverityForAlert,
  notificationSeverityCopy,
  shouldNotifyTelegramAlert,
} from '../backend/services/alert-notification-policy.js';
import { formatTelegramAlertTime } from '../backend/services/telegram-time.js';

function severityForAlertType(alertType) {
  if (['stranger_detected', 'camera_blocked', 'access_denied', 'rfid_invalid'].includes(alertType)) {
    return 'danger';
  }
  if (['object_left', 'motion', 'door_open'].includes(alertType)) {
    return 'warning';
  }
  return 'info';
}

test('sends Telegram notification for explicit danger alerts', () => {
  assert.equal(
    shouldNotifyTelegramAlert({
      alertType: 'stranger_detected',
      message: 'Test stranger alert',
      severity: 'danger',
    }, severityForAlertType),
    true
  );
});

test('does not send Telegram notification for informational alerts', () => {
  assert.equal(
    shouldNotifyTelegramAlert({
      alertType: 'rfid_scan',
      message: 'Test RFID scan',
      severity: 'info',
    }, severityForAlertType),
    false
  );
});

test('sends Telegram notification for object-left warning alerts', () => {
  assert.equal(
    shouldNotifyTelegramAlert({
      alertType: 'object_left',
      message: 'Test object left',
      severity: 'warning',
    }, severityForAlertType),
    true
  );
});

test('does not send Telegram notification for other warning alerts', () => {
  assert.equal(
    shouldNotifyTelegramAlert({
      alertType: 'door_open',
      message: 'Test door opened',
      severity: 'warning',
    }, severityForAlertType),
    false
  );
});

test('sends Telegram notification when alert type defaults to danger', () => {
  const alert = {
    alertType: 'rfid_invalid',
    message: 'Invalid RFID card',
  };

  assert.equal(notificationSeverityForAlert(alert, severityForAlertType), 'danger');
  assert.equal(shouldNotifyTelegramAlert(alert, severityForAlertType), true);
});

test('escapes dynamic Telegram Markdown text', () => {
  assert.equal(
    escapeTelegramMarkdownText('stranger_detected run_id'),
    'stranger\\_detected run\\_id'
  );
});

test('uses user-facing copy for known alert types', () => {
  const copy = notificationCopyForAlert({
    alertType: 'stranger_detected',
    message: 'E2E level 1 Telegram alert',
  });

  assert.equal(copy.typeLabel, 'Phát hiện người lạ');
  assert.match(copy.description, /người lạ/i);
});

test('uses visual severity badges for Telegram alerts', () => {
  assert.equal(notificationSeverityCopy('danger').badge, '🔴 Nguy hiểm');
  assert.equal(notificationSeverityCopy('warning').badge, '🟠 Cảnh báo');
  assert.equal(notificationSeverityCopy('info').badge, '🔵 THÔNG TIN');
});

test('displays camera-blocked danger alerts as warnings in Telegram copy', () => {
  const alert = {
    alertType: 'camera_blocked',
    severity: 'danger',
  };

  assert.equal(notificationSeverityForAlert(alert, severityForAlertType), 'danger');
  assert.equal(notificationDisplaySeverityForAlert(alert, severityForAlertType), 'warning');
});

test('formats Telegram alert time from Supabase timestamps', () => {
  assert.equal(
    formatTelegramAlertTime('2026-07-29T11:00:30.240338+00:00'),
    '18:00:30 29/7/2026'
  );
});
