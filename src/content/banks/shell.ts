import type { Bank } from '../grammar'

/**
 * Fake shell command lines for the prompt.
 *
 * The prompt never echoes raw keystrokes -- mashing "adfjkl" showing up
 * literally on screen destroys the illusion instantly. Instead every
 * keystroke reveals one more character of a generated command drawn from
 * here, so hammering the keyboard reads as a hacker typing fast.
 */
export const shell: Bank = {
  cmd: [
    { t: 'nmap -sS -Pn {ip} -p{port},{port} --open', w: 3 },
    { t: 'ssh -i ~/.keys/{hex:6}.pem root@{host}', w: 3 },
    { t: 'hydra -l root -P rockyou.txt {ip} ssh', w: 2 },
    { t: 'openssl enc -d -aes-256-cbc -in {hex:6}.enc', w: 2 },
    { t: 'tcpdump -i eth0 host {ip} -w cap_{hex:4}.pcap', w: 2 },
    { t: 'msfconsole -q -x "use exploit/multi/handler"', w: 2 },
    { t: 'curl -sk https://{host}/api/v1/tokens', w: 2 },
    { t: 'psql -h {ip} -U admin -c "SELECT * FROM users;"', w: 2 },
    { t: 'scp root@{host}:/var/backups/{hex:4}.tar.gz .', w: 2 },
    { t: 'gdb -p {int:200-9999} -ex "info proc mappings"', w: 1 },
    { t: 'objdump -d /usr/sbin/{exename} | grep -A4 main', w: 1 },
    { t: 'iptables -I INPUT -s {ip} -j ACCEPT', w: 2 },
    { t: 'dig +short {host} @{ip}', w: 2 },
    { t: 'nc -lvnp {int:1024-65535}', w: 2 },
    { t: 'john --wordlist=keys.lst hash_{hex:4}.txt', w: 2 },
    { t: 'aircrack-ng -w /opt/wl.txt cap_{hex:4}.cap', w: 1 },
    { t: 'setarch -R ./exploit --target {ip} --port {port}', w: 1 },
    { t: 'python3 -c \'__import__("pty").spawn("/bin/sh")\'', w: 1 },
    { t: 'find / -perm -4000 -type f 2>/dev/null', w: 2 },
    { t: 'cat /proc/{int:200-9999}/maps | head -40', w: 1 },
    { t: 'strings -n 12 /dev/shm/{hex:4} | grep -i key', w: 1 },
    { t: 'route add -net {ip}/24 gw {ip2}', w: 1 },
    { t: 'chattr -ia /etc/shadow && vipw', w: 1 },
    { t: 'xxd -s 0x{hex:4} -l 256 core.{int:100-9999}', w: 1 },
  ],
  exename: ['agentd', 'watchdog', 'syncd', 'updater', 'relayd', 'authsvc'],
}
