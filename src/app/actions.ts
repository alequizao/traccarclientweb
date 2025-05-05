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

const FETCH_TIMEOUT_MS = 30000; // 30 segundos

/**
 * Envia dados de localização para o servidor Traccar especificado usando o protocolo OsmAnd.
 * Esta função roda no servidor, contornando problemas de CORS e conteúdo misto do navegador.
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

  // Constrói os parâmetros da URL para o protocolo OsmAnd
  const params = new URLSearchParams({
    id: deviceId,
    lat: lat.toString(),
    lon: lon.toString(),
    timestamp: timestamp.toString(),
  });

  // Adiciona parâmetros opcionais apenas se tiverem valores válidos
  if (accuracy !== undefined && accuracy >= 0) params.append('accuracy', accuracy.toString());
  if (altitude !== undefined) params.append('altitude', altitude.toString());
  // Traccar espera velocidade em nós (knots). Se a entrada for m/s, converta (1 m/s ≈ 1.94384 knots).
  // Se a entrada já estiver em nós, use diretamente. Assumindo que a entrada é m/s aqui.
  if (speed !== undefined && speed >= 0) {
      const speedInKnots = speed * 1.94384;
      params.append('speed', speedInKnots.toFixed(2)); // Envia velocidade em nós
  }
  if (bearing !== undefined && bearing >= 0) params.append('bearing', bearing.toString()); // 'bearing' é o heading/direção

  // Monta a URL final com os parâmetros
  const urlWithParams = `${validatedUrl.origin}${validatedUrl.pathname.endsWith('/') ? validatedUrl.pathname : validatedUrl.pathname + '/'}?${params.toString()}`; // Garante que a URL base termine com / se não tiver path explícito

  console.log(`[Server Action] Enviando POST para: ${urlWithParams}`);

  try {
    const response = await fetch(urlWithParams, {
      method: 'POST',
      headers: {
        // O protocolo OsmAnd geralmente não precisa de Content-Type ou corpo,
        // mas Content-Length: 0 pode ser necessário para alguns proxies/servidores.
        'Content-Length': '0',
        'Accept': 'text/plain', // Indica que esperamos texto simples (geralmente vazio)
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // Define o timeout da requisição
    });

    console.log(`[Server Action] Status da Resposta: ${response.status}`);

    if (response.ok) {
      // Traccar geralmente retorna 200 OK ou 202 Accepted com corpo vazio
      return { success: true, message: 'Localização enviada com sucesso para o servidor Traccar.' };
    } else {
      // Se o servidor Traccar respondeu com erro (4xx, 5xx)
      const statusText = response.statusText || `Código ${response.status}`;
      const responseBody = await response.text().catch(() => 'Não foi possível ler o corpo da resposta.');
      console.error(`[Server Action] Erro do Servidor Traccar: ${statusText}`, responseBody);
      return { success: false, message: `Falha no servidor Traccar (${statusText}). Detalhes: ${responseBody.substring(0, 200)}` };
    }
  } catch (error: any) {
    console.error("[Server Action] Erro durante o fetch:", error);

    let userFriendlyMessage = 'Ocorreu um erro no servidor ao tentar enviar os dados para o Traccar.';
    const targetServer = validatedUrl.origin;

    // Verifica se é um erro de timeout (AbortError ou código específico)
    if (error.name === 'AbortError' || error.code === 'UND_ERR_CONNECT_TIMEOUT' || (error.cause && error.cause.code === 'UND_ERR_CONNECT_TIMEOUT')) {
      userFriendlyMessage = `Tempo esgotado (${FETCH_TIMEOUT_MS / 1000}s) ao tentar conectar ou receber resposta do servidor Traccar (${targetServer}). Verifique se o servidor Traccar está online, se a URL está correta e se não há bloqueios de rede/firewall.`;
      console.error(`[Server Action] Detalhes do Timeout: Causa - ${error.cause ? JSON.stringify(error.cause) : 'N/A'}`);
    }
    // Verifica outros erros de conexão comuns
    else if (error.cause) {
      const cause = error.cause as any;
      console.error("[Server Action] Causa do Erro:", cause);
      if (cause.code === 'ECONNREFUSED') {
        userFriendlyMessage = `Conexão recusada pelo servidor Traccar (${targetServer}). Verifique se o servidor está online e a porta (${validatedUrl.port || (validatedUrl.protocol === 'https:' ? '443' : '80')}) está correta e acessível.`;
      } else if (cause.code === 'ENOTFOUND' || cause.code === 'EAI_AGAIN') {
        userFriendlyMessage = `Não foi possível encontrar/resolver o endereço do servidor Traccar (${validatedUrl.hostname}). Verifique se a URL está correta e se o DNS está funcionando no servidor da aplicação.`;
      } else if (cause.code === 'ECONNRESET') {
        userFriendlyMessage = `A conexão foi redefinida inesperadamente pelo servidor Traccar (${targetServer}). Isso pode indicar um problema temporário no servidor Traccar ou na rede.`;
      } else if (cause.code && (cause.code.startsWith('ERR_TLS_CERT') || cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
        userFriendlyMessage = `Erro de certificado SSL/TLS ao conectar a ${targetServer}. Se estiver usando HTTPS com certificado autoassinado, pode ser necessário ajustar configurações (não recomendado para produção) ou usar HTTP.`;
      } else {
        // Mensagem genérica baseada na causa
        userFriendlyMessage = `Erro de rede (${cause.code || 'desconhecido'}) ao conectar a ${targetServer}. Detalhes: ${cause.message || error.message}. Verifique a conectividade e configurações.`;
      }
    }
    // Fallback para erros genéricos
    else if (error instanceof Error) {
      userFriendlyMessage = `Erro inesperado no servidor: ${error.message}. Verifique os logs do servidor da aplicação para mais detalhes.`;
    }

    return { success: false, message: userFriendlyMessage };
  }
}
