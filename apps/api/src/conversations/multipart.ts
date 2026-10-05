import { CONVERSATION_IMAGE_CONSTRAINTS } from '@lostly/contracts/conversations';
import { getSchemaValidator, ParseError, ValidationError } from 'elysia';
import { LEGACY_REQUEST_MAX_BYTES, mediaType } from '@/http/body-limit';
import { ImageUploadBodyError } from '@/image-upload/errors';
import { readBoundedRequestBody } from '@/image-upload/read-body';
import { ConversationUploadError } from './upload-errors';
import { sendMessageBodySchema } from './model';
const jsonValidator = getSchemaValidator(sendMessageBodySchema, { normalize: false })!;

export const CONVERSATION_MESSAGE_REQUEST_MAX_BYTES =
  CONVERSATION_IMAGE_CONSTRAINTS.maxCount * CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes +
  256 * 1024;
export const CONVERSATION_BODY_READ_TIMEOUT_MS = 30_000;
export const CONVERSATION_UPLOAD_IDLE_SECONDS = 180;

export type SendTransport =
  { kind: 'json'; body: string } | { kind: 'multipart'; body: string; images: File[] };

export async function parseSendRequest(
  request: Request,
  timeoutMs = CONVERSATION_BODY_READ_TIMEOUT_MS,
): Promise<SendTransport> {
  const type = mediaType(request);
  if (type !== 'application/json' && type !== 'multipart/form-data')
    throw new ConversationUploadError('unsupported-media-type');
  const maxBytes =
    type === 'application/json' ? LEGACY_REQUEST_MAX_BYTES : CONVERSATION_MESSAGE_REQUEST_MAX_BYTES;
  if (Number(request.headers.get('content-length')) > maxBytes)
    throw new ConversationUploadError('body-too-large');
  let bytes: Blob;
  try {
    bytes = await readBoundedRequestBody(request, { maxBytes, timeoutMs });
  } catch (error) {
    if (error instanceof ImageUploadBodyError) {
      if (error.reason === 'missing-body') {
        if (type === 'application/json') throw new ParseError();
        throw new ConversationUploadError('invalid-multipart');
      }
      throw new ConversationUploadError(error.reason);
    }
    throw error;
  }
  if (type === 'application/json') {
    let value: unknown;
    try {
      value = JSON.parse(await bytes.text());
    } catch {
      throw new ParseError();
    }
    if (!jsonValidator.Check(value))
      throw new ValidationError('body', sendMessageBodySchema, value);
    return { kind: 'json', body: (value as { body: string }).body };
  }
  let form: Awaited<ReturnType<Response['formData']>>;
  try {
    form = await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
  } catch {
    throw new ConversationUploadError('invalid-multipart');
  }
  let body: string | undefined;
  const images: File[] = [];
  for (const [name, part] of form.entries()) {
    if (name === 'body' && body === undefined && typeof part === 'string') body = part;
    else if (
      name === 'images' &&
      part instanceof File &&
      images.length < CONVERSATION_IMAGE_CONSTRAINTS.maxCount
    )
      images.push(part);
    else throw new ConversationUploadError('invalid-multipart');
  }
  if (!images.length) throw new ConversationUploadError('invalid-multipart');
  return { kind: 'multipart', body: body ?? '', images };
}
