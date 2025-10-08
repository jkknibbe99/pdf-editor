import pymupdf  # the package is imported as pymupdf

# Replace "your_document.pdf" with the path to your PDF file
doc = pymupdf.open("c-tops.pdf")

# Iterate through each page of the document
for page_num in range(doc.page_count):
    page = doc[page_num]
    
    # Get a generator for all annotations on the page
    annotations = page.annots()
    
    if annotations:
        print(f"--- Page {page_num + 1} has annotations ---")
        
        # Iterate through the annotations on the current page
        for annot in annotations:
            # The 'annot.info' attribute is a dictionary with annotation details
            print("Annotation Info:", annot.info)
            
            # The 'annot.type' attribute returns a descriptive string of the type
            print("Annotation Type:", annot.type)
            
            # Get the text for text-based annotations
            # Use 'annot.get_text()' for free text and stamp annotations
            if annot.type == "FreeText" or annot.type == "Stamp":
                text = annot.get_text()
                print("Annotation Text:", text)
            
            # For highlight annotations, you can extract the highlighted page text
            if annot.type == "Highlight":
                highlighted_text = page.get_text(clip=annot.rect)
                print("Highlighted Text:", highlighted_text)

    else:
        print(f"--- Page {page_num + 1} has no annotations ---")

doc.close()
