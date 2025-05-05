
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
    // Combina erros de validação em uma única mensagem
    const errorMessages = validation.error.errors.map((e) => e.message).join(', ');
    console.error('Erro de Validação da Ação do Servidor:', errorMessages);
    return { success: false, message: `Dados inválidos: ${errorMessages}` };
  }

  const { serverUrl, deviceId, lat, lon, timestamp, accuracy, altitude, speed, bearing } = validation.data;

  // Constrói URL e parâmetros
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

  // Constrói a URL final para a requisição POST
  // Alguns servidores podem esperar parâmetros de query na URL mesmo para POST
  const urlWithParams = `${validatedUrl.origin}${validatedUrl.pathname}?${params.toString()}`;


  console.log(`Ação do Servidor: Enviando POST para ${urlWithParams}`);

  try {
    // Fetch do lado do servidor não tem problemas de CORS
    const response = await fetch(urlWithParams, {
      method: 'POST',
      // Cabeçalhos podem não ser necessários, mas definir Content-Length como 0 às vezes é necessário para POST sem corpo
      headers: {
          'Content-Length': '0'
      },
      // Aumenta o timeout para 30 segundos
      signal: AbortSignal.timeout(30000), // Aumentado para 30 segundos
    });

    console.log(`Ação do Servidor: Status da Resposta: ${response.status}`);

    if (response.ok) {
      // O protocolo Traccar OsmAnd geralmente retorna 200 OK com corpo vazio em caso de sucesso
      return { success: true, message: 'Localização enviada com sucesso (servidor).' };
    } else {
      const statusText = response.statusText || `Código ${response.status}`;
      const responseBody = await response.text().catch(() => 'Não foi possível ler o corpo da resposta.'); // Tenta obter mais detalhes
      console.error(`Erro da Ação do Servidor: ${statusText}`, responseBody);
      return { success: false, message: `Falha no servidor Traccar: ${statusText}. Detalhes: ${responseBody.substring(0, 100)}` };
    }
  } catch (error: any) { // Usando 'any' para inspecionar a causa
    console.error("Erro de Fetch da Ação do Servidor:", error);
    console.error("Detalhes do Erro (Causa):", error?.cause); // Log da causa do erro

    let errMsg = 'Erro desconhecido no servidor ao enviar dados.';
     if (error instanceof Error) {
        // Usa error.name para verificação de AbortError
        if (error.name === 'AbortError' || error.message.includes('timed out')) {
            errMsg = `Tempo esgotado (30s) ao conectar ao servidor Traccar (${validatedUrl.origin}). Verifique se está online, acessível pela rede do servidor da aplicação e se o firewall permite a conexão.`;
        } else if (error.message.includes('fetch failed')) {
            // Erros genéricos de 'fetch failed' podem ter causas variadas
            const cause = error.cause as any; // Tenta obter mais detalhes da causa
            if (cause?.code === 'ECONNREFUSED') {
                errMsg = `Conexão recusada pelo servidor Traccar (${validatedUrl.origin}). Verifique se está online e a porta (${validatedUrl.port || 'padrão'}) está correta e escutando.`;
            } else if (cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN') {
                errMsg = `Não foi possível encontrar/resolver o servidor Traccar (${validatedUrl.origin}). Verifique a URL e a configuração de DNS do servidor da aplicação.`;
            } else if (cause?.code === 'ECONNRESET') {
                 errMsg = `A conexão foi redefinida pelo servidor Traccar (${validatedUrl.origin}).`;
            } else if (cause?.code && cause.code.startsWith('ERR_TLS_CERT') || cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
                 errMsg = `Erro de certificado SSL/TLS ao conectar a ${validatedUrl.origin}. Se estiver usando HTTPS com um certificado autoassinado, configure o servidor para confiar nele ou use HTTP.`;
            }
             else {
                // Mensagem genérica para 'fetch failed' se nenhuma causa específica for encontrada
                errMsg = `Erro de rede no servidor ao tentar conectar a ${validatedUrl.origin}: fetch failed. Verifique a conectividade da rede do servidor, firewall e se a URL está correta. Causa: ${cause?.code || error.message}`;
            }
        }
         else {
             // Outros erros de rede não relacionados a timeout ou fetch failed
            errMsg = `Erro de rede no servidor: ${error.message}`;
        }
    }
    return { success: false, message: errMsg };
  }
}
