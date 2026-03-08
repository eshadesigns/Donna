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

function extractAddress(text: string, fallback: string): string {
  const match = text.match(/\d+\s[\w\s.]+(?:St|Ave|Blvd|Dr|Rd|Way|Ln|Ct|Pl|Pkwy|Hwy|Suite|Ste)[.,\s]+[\w\s]+,\s*[A-Z]{2}\s*\d{5}/i);
  return match ? match[0].trim() : fallback;
}

//Search nearby businesses

export async function searchNearby(
  query: string,
  location: string,
  _radius: string = "10 miles"
): Promise<BusinessResult[]> {
  // Constrain to business directory domains so Tavily returns actual listings, not blog articles
  const searchQuery = `${query} in ${location} restaurant bar venue hours phone address reservations`;

  const response = await client.search(searchQuery, {
    searchDepth: "advanced",
    maxResults: 10,
    includeAnswer: true,
    includeDomains: [
      "yelp.com",
      "tripadvisor.com",
      "opentable.com",
      "resy.com",
      "google.com/maps",
      "maps.google.com",
      "vagaro.com",
      "booksy.com",
      "styleseat.com",
      "mindbodyonline.com",
      "zocdoc.com",
    ],
  });

  // If domain-restricted search returns too few results, fall back without domain filter
  const results = response.results.length >= 3
    ? response.results
    : (await client.search(searchQuery, { searchDepth: "advanced", maxResults: 10, includeAnswer: true })).results;

  const businesses: BusinessResult[] = results.map((r) => ({
    name: r.title.replace(/\s*[-|].*$/, "").trim(), // strip "Business Name - Yelp" → "Business Name"
    address: extractAddress(r.content, location),
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
