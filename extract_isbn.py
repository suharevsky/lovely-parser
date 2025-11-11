#!/usr/bin/env python3
"""
Extract ISBN from Mondadori Store CSV
Adds a new 'isbn' column by extracting ISBNs from the 'link' column
"""

import pandas as pd
import re
import sys

def extract_isbn_from_link(link):
    """Extract 13-digit ISBN from link using regex pattern /p/(\d{13})"""
    if pd.isna(link) or not isinstance(link, str):
        return ""

    # Pattern to match /p/ followed by 13 digits
    pattern = r'/p/(\d{13})'
    match = re.search(pattern, link)

    if match:
        return match.group(1)
    else:
        return ""

def main():
    input_file = "mondadoristore-ACTUAL.csv"
    output_file = "mondadoristore-ACTUAL-with-isbn.csv"

    print(f"Reading CSV file: {input_file}")

    try:
        # Read CSV with proper encoding (UTF-8 with BOM)
        df = pd.read_csv(input_file, encoding='utf-8-sig')

        print(f"Original CSV shape: {df.shape}")
        print(f"Columns: {list(df.columns)}")

        # Extract ISBNs from the 'link' column
        print("Extracting ISBNs from 'link' column...")
        df['isbn'] = df['link'].apply(extract_isbn_from_link)

        # Reorder columns to put 'isbn' first
        cols = ['isbn'] + [col for col in df.columns if col != 'isbn']
        df = df[cols]

        # Count successful extractions
        isbn_count = (df['isbn'] != "").sum()
        total_rows = len(df)

        print(f"Successfully extracted {isbn_count} ISBNs out of {total_rows} rows")
        print(f"Success rate: {isbn_count/total_rows*100:.1f}%")

        # Show sample of extracted ISBNs
        sample_isbns = df[df['isbn'] != ""].head(5)
        print("\nSample extracted ISBNs:")
        for idx, row in sample_isbns.iterrows():
            print(f"  {row['isbn']} <- {row['link']}")

        # Save to new CSV file
        print(f"\nSaving to: {output_file}")
        df.to_csv(output_file, index=False, encoding='utf-8-sig')

        print(f"New CSV shape: {df.shape}")
        print("Processing completed successfully!")

    except FileNotFoundError:
        print(f"Error: File '{input_file}' not found!")
        sys.exit(1)
    except Exception as e:
        print(f"Error processing CSV: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()