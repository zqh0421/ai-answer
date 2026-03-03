const BRAND_NAME = "SlideItRight Feedback System";
const BRAND_SUFFIX = " | SlideItRight";
const MAX_RESOURCE_TITLE_LENGTH = 72;
const MAX_DOCUMENT_TITLE_LENGTH = 96;
const QUESTION_ID_SUFFIX_LENGTH = 8;

type QuestionContentLike = {
  type?: string;
  content?: unknown;
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const truncate = (value: string, maxLength: number) => {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const extractTextContent = (content?: QuestionContentLike[]) => {
  if (!Array.isArray(content)) return "";
  const textItem = content.find((item) => item?.type === "text" && typeof item?.content === "string");
  return typeof textItem?.content === "string" ? textItem.content : "";
};

const getQuestionTypeLabel = (type?: string) => {
  const normalized = String(type ?? "").toLowerCase();
  if (normalized.includes("multiple") || normalized.includes("mcq")) return "MCQ";
  if (normalized.includes("open") || normalized.includes("oeq")) return "OEQ";
  return "Question";
};

export const buildQuestionResourceTitle = ({
  questionId,
  type,
  content,
}: {
  questionId?: string;
  type?: string;
  content?: QuestionContentLike[];
}) => {
  const typeLabel = getQuestionTypeLabel(type);
  const normalizedQuestionId = normalizeWhitespace(String(questionId ?? ""));
  const shortQuestionId = normalizedQuestionId ? normalizedQuestionId.slice(0, QUESTION_ID_SUFFIX_LENGTH) : "";
  const idSuffix = shortQuestionId ? ` [${shortQuestionId}]` : "";

  const basePrefix = `${typeLabel}: `;
  const maxPreviewLength = Math.max(
    0,
    MAX_RESOURCE_TITLE_LENGTH - basePrefix.length - idSuffix.length
  );
  const preview = truncate(extractTextContent(content), maxPreviewLength);

  if (preview) {
    return `${basePrefix}${preview}${idSuffix}`;
  }

  if (normalizedQuestionId) {
    return truncate(`${typeLabel} ${normalizedQuestionId}`, MAX_RESOURCE_TITLE_LENGTH);
  }

  return truncate(typeLabel, MAX_RESOURCE_TITLE_LENGTH);
};

export const buildDocumentTitle = (resourceTitle?: string) => {
  if (!resourceTitle) return BRAND_NAME;
  return truncate(`${resourceTitle}${BRAND_SUFFIX}`, MAX_DOCUMENT_TITLE_LENGTH);
};

export const buildStaticPageTitle = (pageName?: string) => {
  const normalized = normalizeWhitespace(pageName ?? "");
  if (!normalized) return BRAND_NAME;
  return truncate(`${normalized}${BRAND_SUFFIX}`, MAX_DOCUMENT_TITLE_LENGTH);
};

const fallbackTitleFromPathname = (pathname: string) => {
  const mcqMatch = pathname.match(/\/mcq\/([^/]+)/i);
  if (mcqMatch) return truncate(`MCQ ${mcqMatch[1]}`, MAX_RESOURCE_TITLE_LENGTH);

  const oeqMatch = pathname.match(/\/oeq\/([^/]+)/i);
  if (oeqMatch) return truncate(`OEQ ${oeqMatch[1]}`, MAX_RESOURCE_TITLE_LENGTH);

  return "SlideItRight Resource";
};

export const buildDeepLinkPayloadTitle = ({
  documentTitle,
  pathname,
}: {
  documentTitle?: string;
  pathname: string;
}) => {
  const normalizedTitle = normalizeWhitespace(documentTitle ?? "");
  const withoutBrandSuffix = normalizedTitle.replace(/\s+\|\s+SlideItRight$/i, "").trim();

  if (withoutBrandSuffix && withoutBrandSuffix !== BRAND_NAME) {
    return truncate(withoutBrandSuffix, MAX_RESOURCE_TITLE_LENGTH);
  }

  return fallbackTitleFromPathname(pathname);
};
