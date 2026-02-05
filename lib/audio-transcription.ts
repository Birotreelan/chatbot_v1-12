import OpenAI from "openai"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * Downloads media (audio, image, etc.) from WhatsApp servers
 * WhatsApp provides a media_id that needs two API calls:
 * 1. Get the URL of the media file using the media_id
 * 2. Download the file from that URL
 */
export async function downloadWhatsAppMedia(mediaId: string, accessToken: string): Promise<Buffer> {
  console.log(`[AUDIO] Descargando media de WhatsApp: ${mediaId}`)

  // Step 1: Get the media URL
  const mediaInfoUrl = `https://graph.facebook.com/v17.0/${mediaId}`
  const urlResponse = await fetch(mediaInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!urlResponse.ok) {
    const error = await urlResponse.json()
    console.error(`[AUDIO] Error obteniendo URL del media:`, error)
    throw new Error(`Error getting media URL: ${JSON.stringify(error)}`)
  }

  const mediaInfo = await urlResponse.json()
  const mediaUrl = mediaInfo.url

  console.log(`[AUDIO] URL del media obtenida, descargando archivo...`)

  // Step 2: Download the actual file
  const fileResponse = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!fileResponse.ok) {
    console.error(`[AUDIO] Error descargando archivo de media: ${fileResponse.status}`)
    throw new Error(`Error downloading media file: ${fileResponse.status}`)
  }

  const arrayBuffer = await fileResponse.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  console.log(`[AUDIO] Archivo descargado exitosamente (${buffer.length} bytes)`)

  return buffer
}

/**
 * Transcribes an audio buffer using OpenAI's Whisper API
 * Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg
 * WhatsApp audio messages are typically in .ogg format with Opus codec
 */
export async function transcribeAudio(audioBuffer: Buffer, mimeType = "audio/ogg"): Promise<string> {
  console.log(`[AUDIO] Iniciando transcripcion con Whisper (${audioBuffer.length} bytes, ${mimeType})`)

  try {
    // Determine file extension from mime type
    const extensionMap: Record<string, string> = {
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/wav": "wav",
      "audio/webm": "webm",
      "audio/x-m4a": "m4a",
    }

    const extension = extensionMap[mimeType] || "ogg"
    const filename = `audio.${extension}`

    // Create a File object from the buffer
    const file = new File([audioBuffer], filename, { type: mimeType })

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "es", // Optimized for Spanish
    })

    console.log(`[AUDIO] Transcripcion completada: "${transcription.text.substring(0, 100)}..."`)

    return transcription.text
  } catch (error) {
    console.error(`[AUDIO] Error en transcripcion:`, error)
    throw error
  }
}

/**
 * Combined function to download and transcribe WhatsApp audio
 */
export async function transcribeWhatsAppAudio(
  mediaId: string,
  accessToken: string,
  mimeType = "audio/ogg",
): Promise<string> {
  const audioBuffer = await downloadWhatsAppMedia(mediaId, accessToken)
  const transcription = await transcribeAudio(audioBuffer, mimeType)
  return transcription
}
