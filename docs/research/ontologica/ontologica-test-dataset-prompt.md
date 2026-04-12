# Ontologica Test Dataset Generator Prompt

> Paste this into ChatGPT to generate an adversarial test dataset for Ontologica.

---

I need you to generate a realistic, messy dataset representing a small business. The goal is to stress-test an AI-powered ontology extraction system — so make it as challenging as possible for automated concept/relationship extraction. Here are the requirements:

**The business:** Pick a small-to-medium business in a domain that has inherent complexity — something like an auto repair shop that also sells parts, a veterinary clinic with boarding services, or a catering company that does event planning. The business should span multiple sub-domains that overlap (e.g., inventory + services + scheduling + customer management).

**Generate these 5 documents as separate files:**

1. **A product/service catalog** (~80-120 items) as a CSV. Make it messy:
   - Inconsistent naming (some items abbreviated, some with typos, some with brand names mixed into descriptions)
   - Duplicate items under different names
   - Categories that overlap or are inconsistently applied
   - Some items that are bundles/packages of other items (but not explicitly linked)
   - Prices in mixed formats ($12, 12.00, "call for quote", "varies")
   - Some rows with missing fields

2. **Standard Operating Procedures** (~2000 words) as plain text. Written the way a real small business owner writes — not polished:
   - Run-on sentences, informal language, abbreviations
   - Implicit domain knowledge (references to things not fully defined)
   - Procedures that reference roles, tools, systems, and locations by inconsistent names
   - Some procedures contradict each other slightly
   - Mix of high-level policies and hyper-specific step-by-step instructions

3. **Customer complaints/support tickets** (25-30 entries) as a CSV with columns: date, customer_name, subject, description, resolution, status. Make them:
   - Written in natural messy language with typos and abbreviations
   - Reference products/services by nicknames or partial names (not matching the catalog exactly)
   - Some tickets reference other tickets or previous interactions
   - Include implicit relationships (e.g., a complaint about service X reveals that X depends on product Y)
   - Mix of resolved and unresolved, some with vague resolutions

4. **An employee handbook excerpt** (~1500 words) as plain text covering:
   - Org structure (but described narratively, not as a chart)
   - Role descriptions that overlap (who does what is ambiguous)
   - References to tools, software systems, and vendors by name
   - Training requirements that imply prerequisite knowledge
   - Some policies that implicitly define business concepts (e.g., "tier 2 customers get priority scheduling" — what's a tier 2 customer?)

5. **A messy spreadsheet dump** (~50 rows) as CSV — something like a combined invoice/order log:
   - Columns that mix concerns (customer info + product info + payment info in one row)
   - Free-text notes column with rich implicit information
   - Date formats that vary (MM/DD/YYYY, YYYY-MM-DD, "last Tuesday", "March")
   - References to employees, customers, and products by first name only or partial identifiers
   - Some calculated fields that don't add up

**Critical requirements:**
- The 5 documents should be internally consistent enough that a human could piece together the real business model, but messy enough that automated extraction will struggle
- There should be at least 30 distinct domain concepts (entities/classes) hidden across the documents
- There should be at least 40 relationships between those concepts, most of them implicit rather than stated
- Include at least 5 concepts that appear under 3+ different names across documents
- Include hierarchies that are never explicitly stated (e.g., "oil change" is a type of "maintenance service" is a type of "service" — but no document says this)
- The domain should have at least 2 areas where classification is genuinely ambiguous (is X a product or a service? Is Y a role or a department?)

Output each document in a clearly labeled section. After all 5 documents, provide a **hidden answer key** (labeled as such) listing: all 30+ concepts, all 40+ relationships, all synonyms/aliases, all implicit hierarchies, and the 2+ ambiguous classifications. This is for evaluation only — the system being tested will never see it.
