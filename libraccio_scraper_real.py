#!/usr/bin/env python3
"""
Real Libraccio ISBN scraper using requests and BeautifulSoup
Scrapes https://www.libraccio.it for book information based on ISBN
"""

import sys
import json
import argparse
import requests
import warnings
from bs4 import BeautifulSoup
import time
import urllib.parse

# Suppress SSL warnings
warnings.filterwarnings('ignore', message='urllib3 v2 only supports OpenSSL 1.1.1+')

def search_isbn(isbn):
    """Search for ISBN on Libraccio website using requests"""
    try:
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'it-IT,it;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        })

        print(f"Searching for ISBN: {isbn}", file=sys.stderr)

        # First, get the main page to understand the form structure
        print("Getting main page...", file=sys.stderr)
        response = session.get('https://www.libraccio.it', timeout=15)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Look for the search form and get necessary form data
        form = soup.find('form', {'name': 'aspnetForm'})
        if not form:
            print("Could not find main form", file=sys.stderr)
            return create_error_response("Could not find search form")

        # Get form action (should be ./)
        form_action = form.get('action', './')

        # Extract ASP.NET form fields
        viewstate = soup.find('input', {'name': '__VIEWSTATE'})
        viewstate_value = viewstate['value'] if viewstate else ''

        viewstategenerator = soup.find('input', {'name': '__VIEWSTATEGENERATOR'})
        viewstategenerator_value = viewstategenerator['value'] if viewstategenerator else ''

        eventvalidation = soup.find('input', {'name': '__EVENTVALIDATION'})
        eventvalidation_value = eventvalidation['value'] if eventvalidation else ''

        print(f"Form data extracted, searching for ISBN {isbn}", file=sys.stderr)

        # Try different search approaches
        search_urls = [
            f"https://www.libraccio.it/ricerca.aspx?q={urllib.parse.quote(isbn)}",
            f"https://www.libraccio.it/libri.aspx?q={urllib.parse.quote(isbn)}",
            f"https://www.libraccio.it/search.aspx?q={urllib.parse.quote(isbn)}",
        ]

        for search_url in search_urls:
            try:
                print(f"Trying search URL: {search_url}", file=sys.stderr)
                search_response = session.get(search_url, timeout=15)

                if search_response.status_code == 200:
                    search_soup = BeautifulSoup(search_response.text, 'html.parser')

                    # Look for product information
                    result = extract_book_info(search_soup, isbn, search_response.url)
                    if result["found"]:
                        return result

            except Exception as e:
                print(f"Error with URL {search_url}: {e}", file=sys.stderr)
                continue

        # Try using form submission
        print("Trying form submission approach", file=sys.stderr)
        try:
            form_data = {
                '__VIEWSTATE': viewstate_value,
                '__VIEWSTATEGENERATOR': viewstategenerator_value,
                '__EVENTVALIDATION': eventvalidation_value,
                'ctl00$ctl00$C$Search1$cg2': isbn,  # Main search box
                'ctl00$ctl00$C$Search1$MainSearch': 'Search'  # Search button
            }

            form_response = session.post('https://www.libraccio.it/',
                                       data=form_data,
                                       timeout=15,
                                       allow_redirects=True)

            if form_response.status_code == 200:
                form_soup = BeautifulSoup(form_response.text, 'html.parser')
                result = extract_book_info(form_soup, isbn, form_response.url)
                if result["found"]:
                    return result

        except Exception as e:
            print(f"Form submission error: {e}", file=sys.stderr)

        # Try direct product page approach
        print("Trying direct product page approach", file=sys.stderr)
        try:
            # Many Italian book sites use this pattern
            direct_urls = [
                f"https://www.libraccio.it/libro/{isbn}",
                f"https://www.libraccio.it/libri/{isbn}",
                f"https://www.libraccio.it/prodotto/{isbn}",
            ]

            for direct_url in direct_urls:
                try:
                    direct_response = session.get(direct_url, timeout=10)
                    if direct_response.status_code == 200:
                        direct_soup = BeautifulSoup(direct_response.text, 'html.parser')
                        result = extract_book_info(direct_soup, isbn, direct_response.url)
                        if result["found"]:
                            return result
                except:
                    continue

        except Exception as e:
            print(f"Direct URL error: {e}", file=sys.stderr)

        # If nothing worked, return structured failure
        return create_error_response(f"No book found for ISBN {isbn}")

    except requests.RequestException as e:
        print(f"Request error: {e}", file=sys.stderr)
        return create_error_response(f"Network error: {str(e)}")
    except Exception as e:
        print(f"General error: {e}", file=sys.stderr)
        return create_error_response(f"Error: {str(e)}")

def extract_book_info(soup, isbn, url):
    """Extract book information from the soup"""

    # Look for specific product detail containers (focused approach)
    product_selectors = [
        'div.boxproddetail.pdpboxproddetail',
        'div.boxproddetail',
        'div.pdpboxproddetail',
        'div.product-detail',
        'div.book-info',
        'div.libro-dettaglio',
        '.product-info',
        '.book-detail',
        'div.scheda-prodotto',
        'div.dettaglio-libro',
        'section.product-details'
    ]

    product_div = None
    for selector in product_selectors:
        product_div = soup.select_one(selector)
        if product_div:
            print(f"Found product info with selector: {selector}", file=sys.stderr)
            return {
                "found": True,
                "html": str(product_div),
                "text": product_div.get_text(strip=True),
                "structured_data": {"url": url, "isbn": isbn}
            }

    # Look for content that contains the ISBN (more focused approach)
    if isbn in soup.get_text():
        # Find elements containing the ISBN with substantial content
        for element in soup.find_all(string=lambda text: text and isbn in text):
            parent_div = element.find_parent(['div', 'section', 'article'])
            if parent_div and len(parent_div.get_text(strip=True)) > 200:  # More substantial content
                # Check if this is actually book content and not navigation
                text_content = parent_div.get_text(strip=True).lower()
                # Avoid navigation and menu elements
                if not any(nav_keyword in text_content for nav_keyword in [
                    'menu', 'navigation', 'navbar', 'header', 'footer', 'sidebar',
                    'architettura e urbanistica', 'arte e fotografia', 'bambini e ragazzi'
                ]):
                    print("Found ISBN in substantial content, extracting parent element", file=sys.stderr)
                    return {
                        "found": True,
                        "html": str(parent_div),
                        "text": parent_div.get_text(strip=True),
                        "structured_data": {"url": url, "isbn": isbn}
                    }

    return {"found": False, "html": "", "text": "", "structured_data": {"error": "No book content found", "url": url}}

def create_error_response(error_message):
    """Create a structured error response"""
    return {
        "found": False,
        "html": "",
        "text": "",
        "structured_data": {"error": error_message}
    }

def main():
    parser = argparse.ArgumentParser(description='Real Libraccio scraper for ISBN search')
    parser.add_argument('isbn', help='ISBN to search for')
    parser.add_argument('--headless', action='store_true', default=True, help='Compatibility flag (ignored)')

    args = parser.parse_args()

    print(f"Starting real Libraccio scraper for ISBN: {args.isbn}", file=sys.stderr)

    try:
        result = search_isbn(args.isbn)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        error_result = create_error_response(f"Script error: {str(e)}")
        print(json.dumps(error_result))

if __name__ == "__main__":
    main()