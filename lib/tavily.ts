import { tavily } from "@tavily/core";
import { getCachedResult, storeResult } from "./mongo";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

//Types

export interface BusinessResult {
  name: string;
  address: string;
  phone: string | null;
  hours: string | null;
  onlineBookingUrl: string | null;
  description: string;
  url: string;
  rating?: string;
}

export interface SearchResult {
  found: boolean;
  answer: string | null;
  onlineBookingUrl: string | null;
  source: string;
}

//Helpers

function extractPhone(text: string): string | null {
  const match = text.match(/(\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/);
  return match ? match[1] : null;
}

function extractBookingUrl(text: string, urls: string[]): string | null {
  const bookingKeywords = ["book", "appointment", "schedule", "reserve", "booking"];
  const bookingUrl = urls.find((url) =>
    bookingKeywords.some((kw) => url.toLowerCase().includes(kw))
  );
  if (bookingUrl) return bookingUrl;

  // Check in text body
  const urlMatch = text.match(/https?:\/\/[^\s]+(?:book|appoint|schedul|reserv)[^\s]*/i);
  return urlMatch ? urlMatch[0] : null;
}

//Search nearby businesses

export async function searchNearby(
  query: string,
  location: string,
  radius: string = "10 miles"
): Promise<BusinessResult[]> {
  const searchQuery = `${query} near ${location} within ${radius} phone number address hours`;

  const response = await client.search(searchQuery, {
    searchDepth: "advanced",
    maxResults: 10,
    includeAnswer: true,
  });

  const businesses: BusinessResult[] = response.results.map((r) => ({
    name: r.title,
    address: location, // refined by Gemini later
    phone: extractPhone(r.content),
    hours: null,
    onlineBookingUrl: extractBookingUrl(r.content, [r.url]),
    description: r.content.slice(0, 300),
    url: r.url,
  }));

  return businesses;
}

//Search a specific business — checks cache first

export async function searchBusiness(
  businessName: string,
  query: string
): Promise<SearchResult> {
  // Cache check
  const cached = await getCachedResult(businessName, query);
  if (cached) {
    return {
      found: true,
      answer: cached.answer,
      onlineBookingUrl: cached.onlineBookingUrl,
      source: "cache",
    };
  }

  const searchQuery = `${businessName} ${query} phone hours online booking appointment`;

  const response = await client.search(searchQuery, {
    searchDepth: "advanced",
    maxResults: 5,
    includeAnswer: true,
  });

  const topResult = response.results[0];
  if (!topResult) {
    return { found: false, answer: null, onlineBookingUrl: null, source: "tavily" };
  }

  const allUrls = response.results.map((r) => r.url);
  const onlineBookingUrl = extractBookingUrl(
    response.results.map((r) => r.content).join(" "),
    allUrls
  );

  const answer = response.answer || topResult.content.slice(0, 500);

  // Store in cache
  await storeResult(businessName, query, answer, topResult.url, onlineBookingUrl);

  return {
    found: true,
    answer,
    onlineBookingUrl,
    source: topResult.url,
  };
}
