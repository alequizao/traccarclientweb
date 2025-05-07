// src/app/actions.ts
'use server';

import { z } from 'zod';

// Define o schema para os dados de entrada
const TraccarDataSchema = z.object({
  serverUrl: z.string().url({ message: "URL do Servidor inválida." }),
  deviceId: z.string().min(1, { message: "ID do Dispositivo é obrigatório." }),
  lat: z.number(),
  lon: z.number(),
  timestamp: z.number(),
  accuracy: z.number().optional(),
  altitude: z.number().optional(),
  speed: z.number().optional(),
  bearing: z.number().optional(), // Protocolo Traccar OsmAnd usa 'bearing'
});

export type SendTraccarDataInput = z.infer<typeof TraccarDataSchema>;

const FETCH_TIMEOUT_MS = 30000; // 30 segundos, conforme mensagens de erro recentes

/**
 * Envia dados de localização para o servidor Traccar especificado usando o protocolo OsmAnd.
 * Esta função roda no servidor.
 * @param input - Os dados de localização e configuração do servidor.
 * @returns Um objeto indicando sucesso ou falha com uma mensagem de erro opcional.
 */
export async function sendTraccarData(input: SendTraccarDataInput): Promise<{ success: boolean; message?: string }> {
  const validation = TraccarDataSchema.safeParse(input);

  if (!validation.success) {
    const errorMessages = validation.error.errors.map((e) => e.message).join(', ');
    console.error('[Server Action] Erro de Validação:', errorMessages);
    return { success: false, message: `Dados de entrada inválidos: ${errorMessages}` };
  }

  const { serverUrl, deviceId, lat, lon, timestamp, accuracy, altitude, speed, bearing } = validation.data;

  let validatedUrl: URL;
  try {
    validatedUrl = new URL(serverUrl);
    if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
      throw new Error("Protocolo inválido. A URL deve começar com http:// ou https://");
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "URL inválida";
    console.error('[Server Action] Erro de Análise da URL:', errMsg, serverUrl);
    return { success: false, message: `URL do Servidor Traccar inválida: ${serverUrl}. Detalhe: ${errMsg}` };
  }

  const params = new URLSearchParams({
    id: deviceId,
    lat: lat.toString(),
    lon: lon.toString(),
    timestamp: timestamp.toString(),
  });

  if (accuracy !== undefined && accuracy >= 0) params.append('hdop', (accuracy / 5).toFixed(1)); // OsmAnd usa hdop. Aproximação.
  if (altitude !== undefined) params.append('altitude', altitude.toString());
  if (speed !== undefined && speed >= 0) {
      const speedInKnots = speed * 1.94384; // m/s para knots
      params.append('speed', speedInKnots.toFixed(2));
  }
  if (bearing !== undefined && bearing >= 0) params.append('bearing', bearing.toString());

  const path = validatedUrl.pathname === '/' || validatedUrl.pathname === '' ? '/' : (validatedUrl.pathname.endsWith('/') ? validatedUrl.pathname : validatedUrl.pathname + '/');
  const urlWithParams = `${validatedUrl.origin}${path}?${params.toString()}`;

  console.log(`[Server Action] Enviando POST para: ${urlWithParams} (Timeout: ${FETCH_TIMEOUT_MS / 1000}s)`);

  try {
    const response = await fetch(urlWithParams, {
      method: 'POST',
      headers: { 'Content-Length': '0', 'Accept': 'text/plain' }, // OsmAnd geralmente não precisa de corpo para POST
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const responseBodyForLog = await response.text().catch(() => 'Não foi possível ler o corpo da resposta.');
    console.log(`[Server Action] Status da Resposta Traccar: ${response.status}, StatusText: ${response.statusText}, Corpo: ${responseBodyForLog.substring(0,100)}`);

    if (response.ok) {
      // Considerar resposta vazia ou "OK" como sucesso para Traccar/OsmAnd
      return { success: true, message: `Localização enviada para ${validatedUrl.hostname}. Resposta: ${responseBodyForLog.substring(0,100) || response.statusText}` };
    } else {
      const statusText = response.statusText || `Código ${response.status}`;
      console.error(`[Server Action] Erro do Servidor Traccar: ${statusText}`, responseBodyForLog);
      return { success: false, message: `Falha no servidor Traccar (${statusText}). Detalhes: ${responseBodyForLog.substring(0, 200)}` };
    }
  } catch (error: any) {
    console.error("[Server Action] Erro durante o fetch para Traccar:", error);
    let userFriendlyMessage = 'Ocorreu um erro no servidor da aplicação ao tentar enviar os dados para o Traccar.';
    const targetServer = validatedUrl.origin;

    if (error.name === 'AbortError' || error.message?.includes('timeout') || error.code === 'UND_ERR_CONNECT_TIMEOUT' ) {
       userFriendlyMessage = `Tempo esgotado (${FETCH_TIMEOUT_MS / 1000}s) ao tentar conectar ou receber resposta do servidor Traccar (${targetServer}). Verifique se o servidor Traccar está online, se a URL está correta e se não há bloqueios de rede/firewall.`;
       console.error(`[Server Action] Detalhes do Timeout: Name: ${error.name}, Code: ${error.code}, Message: ${error.message}, Cause: ${error.cause ? JSON.stringify(error.cause) : 'N/A'}`);
    } else if (error.cause) {
      const cause = error.cause as any;
      console.error("[Server Action] Causa do Erro de Fetch:", cause);
      const port = validatedUrl.port || (validatedUrl.protocol === 'https:' ? '443' : '80');
      if (cause.code === 'ECONNREFUSED') {
        userFriendlyMessage = `Conexão recusada pelo servidor Traccar (${targetServer} na porta ${port}). Verifique se o servidor está online e a porta está correta e acessível.`;
      } else if (cause.code === 'ENOTFOUND' || cause.code === 'EAI_AGAIN') {
        userFriendlyMessage = `Não foi possível encontrar/resolver o endereço do servidor Traccar (${validatedUrl.hostname}). Verifique se a URL está correta e se o DNS está funcionando no servidor da aplicação.`;
      } else if (cause.code === 'ECONNRESET') {
        userFriendlyMessage = `A conexão foi redefinida inesperadamente pelo servidor Traccar (${targetServer}). Pode ser um problema temporário no Traccar ou na rede.`;
      } else if (cause.code?.startsWith('ERR_TLS_CERT') || cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || cause.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
        userFriendlyMessage = `Erro de certificado SSL/TLS ao conectar a ${targetServer}. O certificado pode ser inválido, autoassinado ou a cadeia de certificados está incompleta.`;
      } else {
        userFriendlyMessage = `Erro de rede (${cause.code || 'desconhecido'}) ao conectar a ${targetServer}. Detalhes: ${cause.message || error.message}. Verifique a conectividade e configurações.`;
      }
    } else if (error.message?.includes('fetch failed')) { // Fallback genérico para "fetch failed"
        userFriendlyMessage = `Erro de rede no servidor da aplicação ao tentar conectar a ${targetServer}: ${error.message}. Verifique a conectividade da rede do servidor, firewall e se a URL está correta.`;
        if (error.cause) userFriendlyMessage += ` Causa: ${error.cause.code || error.cause.message}`;
    } else if (error instanceof Error) {
      userFriendlyMessage = `Erro inesperado no servidor da aplicação: ${error.message}. Verifique os logs do servidor da aplicação para mais detalhes.`;
    }
    return { success: false, message: userFriendlyMessage };
  }
}
