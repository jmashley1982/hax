import { int, pick, type Rng } from '@/core/rng'
import { hex } from './hex'

/** Fake source/disassembly/SQL/config fragments — cosmetic, never parsed as real code. */

const ASM_OPS = ['mov', 'push', 'pop', 'call', 'jmp', 'test', 'xor', 'cmp', 'lea', 'jne', 'add', 'sub'] as const
const REGS = ['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp', 'r8', 'r9', 'rax', 'rdi'] as const

export function asmLine(rng: Rng): string {
  const op = pick(rng, ASM_OPS)
  const addr = hex(rng, 8)
  const a = pick(rng, REGS)
  const b = pick(rng, REGS)
  return `0x${addr}  ${op.padEnd(5)} ${a}, ${b}`
}

const SQL_TABLES = ['users', 'sessions', 'audit_log', 'credentials', 'assets', 'staff', 'access_tokens'] as const
const SQL_COLS = ['id', 'created_at', 'hash', 'role', 'org_id', 'last_seen', 'status'] as const

export function sqlLine(rng: Rng): string {
  const table = pick(rng, SQL_TABLES)
  const col = pick(rng, SQL_COLS)
  const kind = pick(rng, ['SELECT', 'SELECT COUNT(*)', 'UPDATE', 'DELETE FROM'] as const)
  if (kind.startsWith('SELECT')) {
    return `${kind} FROM ${table} WHERE ${col} = '${hex(rng, 8)}';`
  }
  return `${kind} ${table} SET ${col} = '${hex(rng, 6)}' WHERE id = ${int(rng, 1, 9999)};`
}

const CONFIG_KEYS = [
  'max_connections', 'timeout_ms', 'tls_version', 'log_level', 'retry_count',
  'auth_mode', 'cache_ttl', 'listen_port', 'cluster_id',
] as const
const CONFIG_VALS = ['true', 'false', 'strict', 'permissive', '30000', '8', 'TLSv1.3', 'debug', 'warn'] as const

export function configLine(rng: Rng): string {
  return `${pick(rng, CONFIG_KEYS)} = ${pick(rng, CONFIG_VALS)}`
}
