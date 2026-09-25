// Figures in the Prometheus text format, so Tayyar can be watched like any
// other service: what it streams, how each log is doing, and what the
// watchlist finds.

import { VERSION } from './version.js';
import { shortLogName } from '../web/names.js';

const escape = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export function metricsText({ engine, monitor, hub }) {
  const s = engine.status();
  const lines = [];
  const metric = (name, type, help, samples) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) {
      const l = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${escape(v)}"`).join(',')}}` : '';
      lines.push(`${name}${l} ${Number.isFinite(value) ? value : 0}`);
    }
  };
  const published = s.published || {};
  const logs = s.logs?.list || [];
  const states = {};
  for (const w of logs) states[w.state] = (states[w.state] || 0) + 1;
  const c = monitor.counts;
  metric('tayyar_info', 'gauge', 'The version that is running.', [[{ version: VERSION }, 1]]);
  metric('tayyar_uptime_seconds', 'gauge', 'Seconds since the stream started.', [[null, s.uptime_seconds]]);
  metric('tayyar_certificates_total', 'counter', 'Certificates streamed, by type.', [[{ type: 'certificate' }, published.X509LogEntry], [{ type: 'precertificate' }, published.PrecertLogEntry]]);
  metric('tayyar_certificates_per_second', 'gauge', 'Certificates streamed per second, recently.', [[null, s.certificates_per_second]]);
  metric('tayyar_duplicates_total', 'counter', 'Copies dropped because another log delivered the certificate first.', [[null, s.duplicates_dropped]]);
  metric('tayyar_unreadable_entries_total', 'counter', 'Log entries that could not be parsed.', [[null, s.unreadable_entries]]);
  metric('tayyar_skipped_entries_total', 'counter', 'Entries skipped to stay live after falling far behind.', [[null, s.entries_skipped_to_stay_live]]);
  metric('tayyar_logs', 'gauge', 'Logs being read, by state.', Object.entries(states).map(([state, n]) => [{ state }, n]));
  metric('tayyar_log_lag_entries', 'gauge', 'Entries between the signed tree size and the next one to read, by log.', logs.filter((w) => Number.isFinite(w.lag)).map((w) => [{ log: shortLogName(w.name) }, w.lag]));
  metric('tayyar_log_errors_total', 'counter', 'Failed requests, by log.', logs.map((w) => [{ log: shortLogName(w.name) }, w.errors]));
  metric('tayyar_names_checked_total', 'counter', 'Names compared with the watchlist.', [[null, c.names]]);
  metric('tayyar_findings_total', 'counter', 'Names that matched a watchlist entry, repeats included.', [[null, c.findings]]);
  metric('tayyar_alerts_raised_total', 'counter', 'New alerts raised.', [[null, c.alerts]]);
  metric('tayyar_alerts', 'gauge', 'Alerts kept, by status.', Object.entries(monitor.alerts.counts().by_status).map(([status, n]) => [{ status }, n]));
  metric('tayyar_webhook_deliveries_total', 'counter', 'Webhook deliveries, by result.', [[{ result: 'sent' }, monitor.notifier.stats.sent], [{ result: 'failed' }, monitor.notifier.stats.failed]]);
  if (hub) metric('tayyar_websocket_clients', 'gauge', 'Connected WebSocket clients, by stream.', ['lite', 'full', 'domains', 'alerts'].map((channel) => [{ channel }, hub.count(channel)]));
  return `${lines.join('\n')}\n`;
}
