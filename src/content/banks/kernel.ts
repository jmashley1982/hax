import type { Bank } from '../grammar'

/** dmesg / syslog / stack-trace flavored lines. */
export const kernel: Bank = {
  dmesg: [
    { t: '[{float:0-9999.9}] {subsystem}: {event}', w: 3 },
    { t: '[{float:0-9999.9}] CPU{int:0-15}: interrupt storm on IRQ{int:0-255}', w: 1 },
    { t: '[{float:0-9999.9}] {subsystem}: firmware rev {hex:4} loaded', w: 2 },
    { t: '[{float:0-9999.9}] audit: uid={int:0-9999} exe="{path}" {verdict}', w: 2 },
  ],
  subsystem: ['pci', 'usb', 'net', 'acpi', 'ext4', 'nvme', 'tcp', 'thermal', 'sched', 'mm'],
  event: [
    'link state up',
    'buffer I/O error on device',
    'entering power-save mode',
    'clock source switched to tsc',
    'watchdog: soft lockup cleared',
    'segment fault recovered',
  ],
  path: ['/usr/sbin/init', '/opt/agent/bin/run', '/var/lib/sys/handler', '/bin/sh', '/etc/cron.d/task'],
  verdict: ['permission denied', 'granted', 'ptrace attach blocked', 'capability dropped'],
}
