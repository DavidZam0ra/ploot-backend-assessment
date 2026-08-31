# worker/

Proceso separado de larga vida (no vive en una función serverless de Next.js). Reclama posts con `scheduled_at <= now()` y `status = scheduled`, llama al mock del proveedor, gestiona reintentos/backoff y el refresco de tokens OAuth.
