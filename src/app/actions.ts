
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
  bearing: z.number().optional(), // Alterado de 'heading' para 'bearing' conforme protocolo Traccar OsmAnd
});

export type SendTraccarDataInput = z.infer<typeof TraccarDataSchema>;

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
    console.error('Erro de Validação da Ação do Servidor:', errorMessages);
    return { success: false, message: `Dados inválidos: ${errorMessages}` };
  }

  const { serverUrl, deviceId, lat, lon, timestamp, accuracy, altitude, speed, bearing } = validation.data;

  let validatedUrl: URL;
  try {
    validatedUrl = new URL(serverUrl);
    if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
        throw new Error("Protocolo inválido. Use http ou https.");
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "URL inválida";
    console.error('Erro de Análise da URL da Ação do Servidor:', errMsg);
    return { success: false, message: `URL do Servidor inválida: ${serverUrl}. ${errMsg}` };
  }

  const params = new URLSearchParams({
    id: deviceId,
    lat: lat.toString(),
    lon: lon.toString(),
    timestamp: timestamp.toString(),
  });

  if (accuracy !== undefined) params.append('accuracy', accuracy.toString());
  if (altitude !== undefined) params.append('altitude', altitude.toString());
  if (speed !== undefined && speed >= 0) params.append('speed', speed.toString());
  if (bearing !== undefined && bearing >= 0) params.append('bearing', bearing.toString());

  const urlWithParams = `${validatedUrl.origin}${validatedUrl.pathname}?${params.toString()}`;

  console.log(`Ação do Servidor: Enviando POST para ${urlWithParams}`);

  const FETCH_TIMEOUT_MS = 30000; // 30 segundos

  try {
    const response = await fetch(urlWithParams, {
      method: 'POST',
      headers: {
          'Content-Length': '0', // Essencial para POST sem corpo com alguns servidores
          'Accept': 'text/plain', // Indica que esperamos texto simples na resposta (embora geralmente vazia)
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // Timeout configurado
    });

    console.log(`Ação do Servidor: Status da Resposta: ${response.status}`);

    if (response.ok) {
      return { success: true, message: 'Localização enviada com sucesso (servidor).' };
    } else {
      const statusText = response.statusText || `Código ${response.status}`;
      const responseBody = await response.text().catch(() => 'Não foi possível ler o corpo da resposta.');
      console.error(`Erro da Ação do Servidor: ${statusText}`, responseBody);
      return { success: false, message: `Falha no servidor Traccar: ${statusText}. Detalhes: ${responseBody.substring(0, 150)}` };
    }
  } catch (error: any) {
    console.error("Erro de Fetch da Ação do Servidor:", error);
    let errMsg = 'Erro desconhecido no servidor ao enviar dados.';

    // Verifica se é um erro de AbortController (timeout)
    if (error.name === 'AbortError' || (error.cause && error.cause.name === 'AbortError') || error.message.includes('timed out')) {
        errMsg = `Tempo esgotado (${FETCH_TIMEOUT_MS / 1000}s) ao tentar conectar ao servidor Traccar (${validatedUrl.origin}). Verifique se o servidor está online, acessível pela rede da aplicação, e se o firewall permite a conexão.`;
        console.error("Detalhes do Erro (Timeout):", error.cause);
    }
    // Verifica erros de conexão específicos se disponíveis na causa (pode variar por ambiente Node.js)
    else if (error.cause) {
        const cause = error.cause as any;
        console.error("Detalhes do Erro (Causa):", cause); // Log da causa
        if (cause.code === 'ECONNREFUSED') {
            errMsg = `Conexão recusada pelo servidor Traccar (${validatedUrl.origin}). Verifique se o servidor está online e a porta (${validatedUrl.port || 'padrão'}) está correta e escutando.`;
        } else if (cause.code === 'ENOTFOUND' || cause.code === 'EAI_AGAIN') {
            errMsg = `Não foi possível encontrar/resolver o host do servidor Traccar (${validatedUrl.hostname}). Verifique a URL e a configuração de DNS do servidor da aplicação.`;
        } else if (cause.code === 'ECONNRESET') {
            errMsg = `A conexão foi redefinida pelo servidor Traccar (${validatedUrl.origin}).`;
        } else if (cause.code && (cause.code.startsWith('ERR_TLS_CERT') || cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
            errMsg = `Erro de certificado SSL/TLS ao conectar a ${validatedUrl.origin}. Se estiver usando HTTPS com um certificado autoassinado, configure o servidor Node.js para confiar nele (não recomendado para produção) ou use HTTP.`;
        } else if (cause.code === 'UND_ERR_CONNECT_TIMEOUT') { // Código específico para timeout de conexão em `undici` (usado pelo Node >= 18 fetch)
             errMsg = `Tempo esgotado (${FETCH_TIMEOUT_MS / 1000}s) ao estabelecer conexão com o servidor Traccar (${validatedUrl.origin}). Verifique a conectividade da rede, firewall e se o servidor está respondendo rapidamente.`;
        }
         else {
            // Mensagem mais genérica baseada na causa, se existir
            errMsg = `Erro de rede no servidor ao conectar a ${validatedUrl.origin}. Causa: ${cause.code || cause.message || error.message}. Verifique a conectividade da rede, firewall e URL.`;
        }
    }
    // Fallback para mensagem de erro genérica se nenhuma causa específica for identificada
    else if (error instanceof Error) {
        errMsg = `Erro de rede no servidor: ${error.message}. Verifique a URL, conectividade e firewall.`;
    }

    return { success: false, message: errMsg };
  }
}
