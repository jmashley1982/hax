import type { EventMap, EventName } from './events'

type Listener<K extends EventName> = (payload: EventMap[K]) => void

/**
 * Minimal typed event emitter. This is the entire "framework" — systems
 * subscribe to named events and never reach into each other's internals.
 * Deliberately hand-rolled and dependency-free (see plan §1: zero runtime
 * dependencies matters for a static prop that needs to keep working
 * unmodified for years).
 */
export class Store {
  private listeners = new Map<EventName, Set<Listener<any>>>()

  on<K extends EventName>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn)
    return () => set!.delete(fn)
  }

  once<K extends EventName>(event: K, fn: Listener<K>): () => void {
    const off = this.on(event, (payload) => {
      off()
      fn(payload)
    })
    return off
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return
    // Copy before iterating: a handler may unsubscribe mid-emit.
    for (const fn of [...set]) fn(payload)
  }
}

/** One global store for the whole app. Imported, never re-instantiated. */
export const store = new Store()
