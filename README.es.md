# ⚙️ Mi configuración completa de OpenCode

<p>
  <a href="https://github.com/MrJmpl3/opencode_____data_____configuration">
    <img src="https://img.shields.io/badge/OPENCODE-CONFIG-2f3136?style=for-the-badge&logo=github&logoColor=white" alt="OpenCode Config" />
  </a>
  <a href="./plugins">
    <img src="https://img.shields.io/badge/READ-THE_PLUGINS-ff2fa3?style=for-the-badge" alt="Leer los plugins" />
  </a>
  <a href="./skills">
    <img src="https://img.shields.io/badge/EXPLORE-SKILLS-374151?style=for-the-badge" alt="Explorar skills" />
  </a>
  <a href="./tui-plugins">
    <img src="https://img.shields.io/badge/TUI-EXTENSIONS-0f76d8?style=for-the-badge" alt="Extensiones TUI" />
  </a>
</p>

<!-- README-I18N:START -->

[English](./README.md) | **Español**

<!-- README-I18N:END -->

Un workspace práctico y opinado de configuración para OpenCode, con plugins personalizados, skills
reutilizables, extensiones de TUI, helpers de modelos, integración con memoria Engram y soporte para
flujos Spec-Driven Development (SDD).

### 🌱 Por qué existe este repo

Si ya usás OpenCode, SDD, Engram o Gentle AI, este repo te ayuda a mejorar tu propio stack sin
empezar desde cero. Muestra cómo organizar:

- **comportamiento global de OpenCode** — agentes, modelos, MCP, permisos, LSPs
- **skills reutilizables** — archivos `SKILL.md` enfocados para lenguajes, frameworks, fases SDD,
  reviews
- **plugins personalizados de runtime** — integración con Engram, variantes de modelos,
  reescritura con RTK, registro de skills
- **plugins de estado para la TUI** — cuotas, caché, límites, monitor de subagentes, branding
- **comandos y prompts SDD** — flujo completo de Spec-Driven Development
- **integración con memoria** — Engram para contexto persistente entre sesiones
- **automatización de reviews y workflows** — PRs encadenados, compuertas de verificación,
  judgment day

> 📖 Es un **mapa de referencia**: leelo para entender la estructura, copiá los patrones que
> encajen con tu flujo y adaptá rutas o supuestos a tu propia máquina.

### 🚀 Empezá por acá

1. **Abrí [`opencode.json`](./opencode.json)**  
   Configuración principal: agentes, modelos, servidores MCP, permisos, LSPs, carga de plugins.
2. **Leé [`AGENTS.md`](./AGENTS.md)**  
   Reglas globales de comportamiento, sesiones, memoria, persona, carga de skills.
3. **Explorá [`plugins/`](./plugins)**  
   Engram, variantes de modelos, reescritura con RTK, skill registry — todos entrypoints planos.
4. **Explorá [`tui-plugins/`](./tui-plugins)**  
   Extensiones para la TUI: cuotas, caché, límites, branding, estado de subagentes.
5. **Revisá [`skills/`](./skills)**  
   Módulos de instrucciones reutilizables para todo, desde fases SDD hasta auditorías de seguridad.
6. **Revisá [`commands/`](./commands) y [`prompts/sdd/`](./prompts/sdd)**  
   Definiciones de comandos y prompts por fase que sostienen el flujo SDD.

### 🧭 Mapa del repositorio

```text
ROOT
│
├── AGENTS.md              # Reglas globales de comportamiento y sesión
├── opencode.json          # Configuración principal de OpenCode
├── tui.json               # Configuración de plugins TUI
├── SECURITY.md            # Política de reporte de vulnerabilidades
│
├── .github/               # Configuración de Dependabot
├── commands/              # Definiciones de comandos personalizados
├── prompts/
│   └── sdd/               # Prompts de fases SDD
│
├── skills/                # 221 skills reutilizables
│   └── _shared/           # Convenciones transversales SDD/Engram/resolución de skills
├── plugins/               # 4 plugins de runtime
├── tui-plugins/           # 2 extensiones TUI
```

### 🔌 Plugins personalizados de OpenCode

El directorio [`plugins/`](./plugins) contiene adaptadores de plugins personalizados para
OpenCode — entrypoints planos de runtime sin paso de build.

| Plugin                                             | Qué agrega                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`engram.ts`](./plugins/engram.ts)                 | Integración con memoria Engram: inicia o conecta el servidor local, captura prompts, inyecta instrucciones de memoria y evita inflar sesiones de subagentes.            |
| [`model-variants.ts`](./plugins/model-variants.ts) | Lee datos de variantes de modelos/proveedores desde OpenCode y escribe una caché local para Gentle AI.                                                                  |
| [`rtk.ts`](./plugins/rtk.ts)                       | Reescribe comandos de shell mediante `rtk rewrite` cuando está disponible para reducir uso de tokens.                                                                  |
| [`skill-registry.ts`](./plugins/skill-registry.ts) | Actualiza el registro local de skills desde el layout aplanado de entrypoints de plugins.                                                                               |

### 🖥️ Plugins de TUI

El directorio [`tui-plugins/`](./tui-plugins) contiene extensiones para la TUI de OpenCode,
conectadas desde [`tui.json`](./tui.json).

| Plugin            | Propósito                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `gentle-logo.tsx` | Branding de Gentle AI para la TUI.                                                                    |
| `agent-monitor`   | Sidebar unificado con secciones de limits, cache, quota, subagent, cost, context-fill, speed y cache-TTL. |

### 🧩 Skills

El directorio [`skills/`](./skills) es la capa de instrucciones reutilizables — archivos
`SKILL.md` enfocados que se cargan cuando una tarea necesita comportamiento específico. Incluye
una capa [`_shared/`](./skills/_shared) con convenciones transversales (contratos de fases SDD,
protocolo Engram, resolución de skills).

| Categoría              | Ejemplos                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| Flujo SDD              | `sdd-apply`, `sdd-design`, `sdd-tasks`, `sdd-verify`, `_shared/` ...   |
| Code review            | `code-review-excellence`, `judgment-day` (revisión ciega dual)          |
| PRs y commits          | `branch-pr`, `chained-pr`, `work-unit-commits`, `issue-creation`        |
| Lenguajes y frameworks | Laravel, Vue, React, Next.js, Nuxt, Python, TypeScript, Go, Rust, .NET  |
| Testing                | Patrones TDD para Laravel (Pest), Python (pytest), JS (Vitest), Go      |
| Seguridad              | Seguridad de APIs, árboles de ataque, mitigación de amenazas            |
| Arquitectura           | Clean/Hexagonal architecture, ADRs, diseño de APIs, design systems      |
| Infraestructura        | Docker, Docker Compose, migraciones, optimización de costos             |
| Gestión de skills      | `skill-creator`, `skill-improver`, `skill-registry`                     |
| Automatización browser | `agent-browser` para interacción web y testing                          |

Esto mantiene `AGENTS.md` más chico e inyecta comportamiento específico solo cuando aporta valor.

### 🛠️ Comandos y flujo SDD

El directorio [`commands/`](./commands) define comandos de workflow orientados al usuario — ciclo
de vida SDD, utilidades y análisis de código.

| Archivo de comando                                | Propósito                                               |
| ------------------------------------------------- | ------------------------------------------------------- |
| [`sdd-new.md`](./commands/sdd-new.md)             | Iniciar un nuevo cambio SDD.                            |
| [`sdd-explore.md`](./commands/sdd-explore.md)     | Explorar una idea antes de comprometerse con un cambio. |
| [`sdd-ff.md`](./commands/sdd-ff.md)               | Avanzar rápido por fases de planificación.              |
| [`sdd-continue.md`](./commands/sdd-continue.md)   | Continuar la próxima fase lista según dependencias.     |
| [`sdd-status.md`](./commands/sdd-status.md)       | Mostrar estado estructurado de un cambio activo.        |
| [`sdd-init.md`](./commands/sdd-init.md)           | Inicializar contexto SDD y configuración de testing.    |
| [`sdd-onboard.md`](./commands/sdd-onboard.md)     | Recorrido guiado del ciclo SDD completo.                |
| [`sdd-apply.md`](./commands/sdd-apply.md)         | Aplicar tareas de implementación.                       |
| [`sdd-verify.md`](./commands/sdd-verify.md)       | Verificar la implementación contra specs y tareas.      |
| [`sdd-archive.md`](./commands/sdd-archive.md)     | Archivar artefactos de cambios completados.             |

Otros comandos disponibles: [`code-audit.md`](./commands/code-audit.md) (análisis de código
fuente a destino), [`skill-creator.md`](./commands/skill-creator.md) y
[`skill-registry.md`](./commands/skill-registry.md) (creación e indexado de skills).

> 💡 Los artefactos SDD se almacenan en **memoria Engram** por defecto, no como archivos. La
> convención `openspec/` existe para equipos que prefieren compartir artefactos basados en archivos.

### 🧪 Desarrollo

Este repo combina configuración de raíz con proyectos de plugins locales. Scripts disponibles:

```bash
npm install
npm run format
npm run format:check
npm test
npm run typecheck
```

Para checks locales de un paquete, ejecutá los comandos dentro del directorio del plugin
correspondiente:

```bash
cd tui-plugins/agent-monitor
npm test
npm run typecheck
```

> ⚠️ **Rutas locales.** Este repo usa rutas absolutas como `/home/mrjmpl3/.config/opencode` y
> binarios locales (`engram`, `rtk`). Antes de reutilizar, revisá: rutas absolutas, nombres de
> proveedores/modelos, configuración MCP, entrypoints de plugins y permisos de shell/Git.
> Estudá la estructura, copiá lo que sirva, adaptá el resto.

### 🔒 Seguridad

Consultá [`SECURITY.md`](./SECURITY.md) para reportar vulnerabilidades.

### 🤝 Contribuir

PRs e issues son bienvenidos. Esta es una configuración viva — si encontrás un bug, ves una mejora
o querés agregar una skill, abrí un issue primero para discutir el enfoque.

1. Revisá los [issues abiertos](https://github.com/MrJmpl3/opencode_____data_____configuration/issues)
2. Hacé fork y branch desde `main`
3. Mantené los cambios enfocados — un PR por tema
4. Ejecutá `npm run format:check` y `npm test` antes de enviar
