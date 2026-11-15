# TCL Home

Esta integración conecta Gladys con su cuenta **TCL Home** y controla los aparatos TCL añadidos
a ella: **aires acondicionados**, **deshumidificadores** y **purificadores de aire Breeva**.

## Antes de empezar

- Se necesita **Gladys 5.3 o posterior**.
- Sus aparatos deben funcionar primero en la app móvil **TCL Home**: añádalos allí, Gladys no
  los empareja.
- Es una integración **en la nube**: Gladys pasa por la nube TCL Home, como la app. Gladys
  necesita Internet, y nada funciona mientras la nube de TCL esté caída. Los aparatos TCL no
  ofrecen control local.

TCL no publica ninguna API oficial: esta integración hace lo que hace la app TCL Home. TCL puede
cambiarla en cualquier momento. No está afiliada a TCL.

## Configuración

En Gladys, abra **Integraciones → TCL Home → Configuración**:

| Campo                          | Qué introducir                                                               |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Correo de TCL Home             | El correo con el que inicia sesión en la app TCL Home                        |
| Contraseña de TCL Home         | La contraseña de esa cuenta                                                  |
| Intervalo de actualización (s) | Cada cuánto se lee cada dispositivo, en segundos (60 a 3600, 60 por defecto) |

Guarde y pulse **Probar la conexión**: lista los dispositivos encontrados, cuántos están en
línea y los dispositivos TCL que esta integración no controla (un televisor, por ejemplo).

Después abra la pestaña **Descubrir** de la integración y añada sus dispositivos.

> Consejo: cree una segunda cuenta TCL Home, compártale su hogar desde la app y dé esa cuenta a
> Gladys. Así su propia contraseña sigue siendo solo suya.

## Dispositivos y funciones

Una función solo aparece si su equipo la indica: un modelo sin oscilación horizontal no tiene
control de oscilación horizontal.

### Aires acondicionados

Split, de ventana, portátiles, por conductos, de columna y de aire fresco.

| Función                                              | En Gladys                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Encendido                                            | Encendido / apagado                                                      |
| Modo                                                 | Automático, frío, deshumidificar, ventilador, calor (según el equipo)    |
| Temperatura objetivo                                 | 16 a 31 °C, en grados enteros                                            |
| Velocidad del ventilador                             | Automático, silencioso, baja, media-baja, media, media-alta, alta, turbo |
| Oscilación vertical / horizontal                     | Apagada, oscilar o una de 5 posiciones fijas                             |
| Temperatura interior                                 | Medida por el equipo                                                     |
| Temperatura de la unidad exterior                    | Si el equipo la indica                                                   |
| Eco, sueño, salud, secado antimoho, pantalla, pitido | Interruptores encendido / apagado                                        |

En un equipo portátil, el modo automático y la velocidad del ventilador solo existen en los
modelos con lama oscilante.

### Deshumidificadores

Encendido y humedad de la habitación.

### Purificadores de aire Breeva

Encendido, PM2.5, pantalla y bloqueo infantil.

### Actualización

Gladys lee cada dispositivo al intervalo elegido. Tras una orden, la integración vuelve a leer
el dispositivo unos segundos después, para que Gladys muestre lo que realmente hizo.

Un dispositivo sin conexión muestra una insignia **inaccesible**; en línea, una insignia
**nube**.

## Escenas

### Disparadores

| Disparador                              | Cuándo                                             | Variable                                      |
| --------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Dispositivo TCL en línea / sin conexión | Un dispositivo pierde o recupera su conexión       | `status`: `online` u `offline`                |
| Error de un dispositivo TCL             | Un dispositivo informa de un nuevo código de error | `code`: el o los códigos, separados por comas |

Ambos pueden limitarse a un dispositivo. Se disparan con un cambio: un dispositivo ya sin
conexión, o un error ya presente al arrancar Gladys, no los dispara.

### Acciones

| Acción                            | Qué hace                                                                                    | Salida                      |
| --------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| Ajustar un aire acondicionado TCL | Enciende el equipo con el modo, la temperatura y la velocidad elegidos (vacío: sin cambios) | `applied` (verdadero/falso) |
| Apagar todos los dispositivos TCL | Apaga todos los dispositivos TCL encendidos                                                 | `count`                     |
| Iniciar autolimpieza TCL          | Inicia el ciclo de autolimpieza del equipo (lo detiene), si el modelo lo tiene              | `started` (verdadero/falso) |

Un equipo sin conexión no detiene la escena: la salida vale `false`, úsela en una condición si
hace falta.

Ejemplo: «Cuando salgo de casa, apagar todos los dispositivos TCL», o «A las 18 h en verano,
poner el equipo del salón en frío a 24 °C».

## Widget del panel

Añada el widget **TCL Home** a un panel. Muestra:

- el estado de la cuenta TCL Home y luego cada dispositivo: apagado, sin conexión, o su modo y
  temperatura objetivo;
- la temperatura interior en directo de los primeros aires acondicionados;
- los botones **Ajustar un aire** (equipo, modo, temperatura, ventilador), **Apagar todo** y
  **Actualizar**.

## Solución de problemas

| Mensaje o síntoma                            | Qué hacer                                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «TCL Home rechaza el correo o la contraseña» | Compruébelos iniciando sesión en la app TCL Home. Una cuenta creada con Google o Apple no tiene contraseña: defina una en la app, o use una segunda cuenta. |
| «No se puede contactar con TCL Home»         | Compruebe el acceso a Internet de Gladys. La integración lo reintenta sola cada 5 minutos.                                                                  |
| Falta un dispositivo                         | ¿Está en la app TCL Home, en la misma cuenta? «Probar la conexión» lista los no compatibles.                                                                |
| Una orden falla con «is offline»             | El dispositivo no está conectado a la nube de TCL: compruebe su Wi-Fi en la app TCL Home.                                                                   |
| El estado cambia con retraso                 | La nube se lee al intervalo de actualización: redúzcalo (60 s como mínimo).                                                                                 |

Ponga el nivel de registro en `debug` (variable de entorno `LOG_LEVEL`) para ver cada llamada.
Las contraseñas y los tokens nunca se escriben en los registros.

## Privacidad

- Gladys guarda la contraseña en un campo secreto y solo se envía a TCL, como hash MD5, igual
  que hace la app.
- Los tokens de TCL y las credenciales temporales de AWS se quedan en memoria, no se escribe
  nada en disco.
- La integración solo habla con TCL (`*.tcl.com`, `*.tcljd.com`) y Amazon Web Services
  (`*.amazonaws.com`), por HTTPS.
