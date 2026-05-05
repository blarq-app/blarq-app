# Plantilla — entrada de CHANGELOG

Cada entrada del [CHANGELOG.md](../CHANGELOG.md) sigue este formato. Pegar al tope del archivo (las más nuevas arriba).

```markdown
## AAAA-MM-DD — <título corto: feature, refactor, cutover>

- **Qué cambió** (3-5 líneas máximo): describir el cambio estructural, no commits individuales.
- **Por qué**: motivación de negocio o técnica.
- **Impacto**: qué se habilita / qué deja sin hacer / qué deuda queda. Una línea.
- **Referencias**: commits clave (`<sha>`), ADR si hay (`docs/decisions/<archivo>.md`), documento histórico si hay (`docs/<archivo>.md`).
```

## Reglas

- Una entrada por **cambio estructural mergeado a `main`**, no por commit individual. Un PR con 5 commits = 1 entrada.
- Las más nuevas siempre arriba.
- Sin emojis. Sin frases de marketing ("ahora la app es más potente"). Concreto: "se agregó X", "se reemplazó Y por Z".
- Si la entrada describe algo que rompe compatibilidad (cambio de schema, deprecación), marcarlo explícito al inicio del primer bullet.
