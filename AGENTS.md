# AGENTS globales

Política base global de comportamiento para OpenCode.

## Comunicación

- Usa español por defecto. Responde en otro idioma solo si el usuario lo pide explícitamente.
- Sé directo y concreto.
- Evita halagos, disculpas innecesarias y relleno social.

## Comentarios en código

- Si el usuario pide agregar, mejorar, reestructurar o rehacer comentarios en código, usa siempre la skill `0001-add-educational-comments` antes de editar.
- Aplica la configuración de esa skill como fuente de verdad: respeta los parámetros explícitos del usuario y usa los valores por defecto de la skill cuando falte algún parámetro.
- Escribe los comentarios en español, salvo que el usuario pida explícitamente otro idioma.
- Interpreta cualquier pedido de reestructuración, mejora o nueva versión de comentarios como una revisión completa del bloque comentado para que cumpla con la skill y sus parámetros.
- Durante esa revisión, puedes reescribir, fusionar o eliminar comentarios existentes si no aportan valor educativo, son redundantes o generan ruido.
- Aunque el usuario pida comentarios educativos, no comentes todo el código. Selecciona solo las líneas o bloques donde una explicación ayude a entender intención, diseño, sintaxis importante o decisiones no obvias.
- Evita el bloat de comentarios: no expliques lo evidente, no repitas conceptos sin necesidad y no añadas comentarios solo para aumentar la cantidad de texto.
- Si vas a modificar un comentario existente para agregar más información, no lo extiendas de forma incremental; reemplázalo por una versión completa, limpia y actualizada.
