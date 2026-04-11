import type Database from 'better-sqlite3';

interface LayerDef {
  slug: string;
  name: string;
  description: string;
  namespace: string;
  version: string;
  category: 'w3c' | 'community' | 'domain' | 'commons';
  is_always_on: boolean;
  dependencies: string[];
  items: ItemDef[];
}

interface ItemDef {
  item_type: 'class' | 'property' | 'datatype' | 'individual';
  uri: string;
  local_name: string;
  label: string;
  description?: string;
  parent_uri?: string;
  domain_uri?: string;
  range_uri?: string;
}

const LAYERS: LayerDef[] = [
  // ─── 1. OWL / RDFS / XSD ──────────────────────────────────────────────
  {
    slug: 'owl-rdfs-xsd',
    name: 'OWL / RDFS / XSD',
    description: 'OWL 2, RDFS, and XSD foundational vocabulary — the building blocks of every ontology.',
    namespace: 'http://www.w3.org/2002/07/owl#',
    version: '2.0',
    category: 'w3c',
    is_always_on: true,
    dependencies: [],
    items: [
      // OWL classes
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#Class', local_name: 'Class', label: 'owl:Class', description: 'The class of all OWL classes' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#Thing', local_name: 'Thing', label: 'owl:Thing', description: 'The class of all individuals' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#Nothing', local_name: 'Nothing', label: 'owl:Nothing', description: 'The empty class' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#NamedIndividual', local_name: 'NamedIndividual', label: 'owl:NamedIndividual', description: 'The class of named individuals' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#ObjectProperty', local_name: 'ObjectProperty', label: 'owl:ObjectProperty', description: 'The class of object properties' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#DatatypeProperty', local_name: 'DatatypeProperty', label: 'owl:DatatypeProperty', description: 'The class of datatype properties' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#AnnotationProperty', local_name: 'AnnotationProperty', label: 'owl:AnnotationProperty', description: 'The class of annotation properties' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#Ontology', local_name: 'Ontology', label: 'owl:Ontology', description: 'The class of ontologies' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#Restriction', local_name: 'Restriction', label: 'owl:Restriction', description: 'The class of property restrictions' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#TransitiveProperty', local_name: 'TransitiveProperty', label: 'owl:TransitiveProperty', description: 'The class of transitive properties' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#SymmetricProperty', local_name: 'SymmetricProperty', label: 'owl:SymmetricProperty', description: 'The class of symmetric properties' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#FunctionalProperty', local_name: 'FunctionalProperty', label: 'owl:FunctionalProperty', description: 'The class of functional properties' },
      { item_type: 'class', uri: 'http://www.w3.org/2002/07/owl#InverseFunctionalProperty', local_name: 'InverseFunctionalProperty', label: 'owl:InverseFunctionalProperty', description: 'The class of inverse-functional properties' },
      // OWL properties
      { item_type: 'property', uri: 'http://www.w3.org/2002/07/owl#sameAs', local_name: 'sameAs', label: 'owl:sameAs', description: 'Asserts two individuals are the same' },
      { item_type: 'property', uri: 'http://www.w3.org/2002/07/owl#differentFrom', local_name: 'differentFrom', label: 'owl:differentFrom', description: 'Asserts two individuals are different' },
      { item_type: 'property', uri: 'http://www.w3.org/2002/07/owl#equivalentClass', local_name: 'equivalentClass', label: 'owl:equivalentClass', description: 'Asserts two classes are equivalent' },
      { item_type: 'property', uri: 'http://www.w3.org/2002/07/owl#disjointWith', local_name: 'disjointWith', label: 'owl:disjointWith', description: 'Asserts two classes are disjoint' },
      { item_type: 'property', uri: 'http://www.w3.org/2002/07/owl#inverseOf', local_name: 'inverseOf', label: 'owl:inverseOf', description: 'Asserts two properties are inverses' },
      // RDFS
      { item_type: 'class', uri: 'http://www.w3.org/2000/01/rdf-schema#Resource', local_name: 'Resource', label: 'rdfs:Resource', description: 'The class of everything' },
      { item_type: 'class', uri: 'http://www.w3.org/2000/01/rdf-schema#Literal', local_name: 'Literal', label: 'rdfs:Literal', description: 'The class of literal values' },
      { item_type: 'class', uri: 'http://www.w3.org/2000/01/rdf-schema#Datatype', local_name: 'Datatype', label: 'rdfs:Datatype', description: 'The class of datatypes' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', local_name: 'subClassOf', label: 'rdfs:subClassOf', description: 'Relates a class to its superclass' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf', local_name: 'subPropertyOf', label: 'rdfs:subPropertyOf', description: 'Relates a property to its superproperty' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#domain', local_name: 'domain', label: 'rdfs:domain', description: 'Declares the domain of a property' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#range', local_name: 'range', label: 'rdfs:range', description: 'Declares the range of a property' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#label', local_name: 'label', label: 'rdfs:label', description: 'A human-readable label' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#comment', local_name: 'comment', label: 'rdfs:comment', description: 'A human-readable description' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#seeAlso', local_name: 'seeAlso', label: 'rdfs:seeAlso', description: 'A related resource for more information' },
      { item_type: 'property', uri: 'http://www.w3.org/2000/01/rdf-schema#isDefinedBy', local_name: 'isDefinedBy', label: 'rdfs:isDefinedBy', description: 'The resource that defines this resource' },
      // RDF core
      { item_type: 'property', uri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', local_name: 'type', label: 'rdf:type', description: 'Asserts the type of a resource' },
      // XSD datatypes
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#string', local_name: 'string', label: 'xsd:string', description: 'A character string' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#integer', local_name: 'integer', label: 'xsd:integer', description: 'An arbitrary-precision integer' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#boolean', local_name: 'boolean', label: 'xsd:boolean', description: 'A boolean (true/false)' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#date', local_name: 'date', label: 'xsd:date', description: 'A calendar date (YYYY-MM-DD)' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#dateTime', local_name: 'dateTime', label: 'xsd:dateTime', description: 'A date and time' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#decimal', local_name: 'decimal', label: 'xsd:decimal', description: 'An arbitrary-precision decimal' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#float', local_name: 'float', label: 'xsd:float', description: 'A 32-bit floating point' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#double', local_name: 'double', label: 'xsd:double', description: 'A 64-bit floating point' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#anyURI', local_name: 'anyURI', label: 'xsd:anyURI', description: 'A Uniform Resource Identifier' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger', local_name: 'nonNegativeInteger', label: 'xsd:nonNegativeInteger', description: 'An integer >= 0' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#positiveInteger', local_name: 'positiveInteger', label: 'xsd:positiveInteger', description: 'An integer > 0' },
      { item_type: 'datatype', uri: 'http://www.w3.org/2001/XMLSchema#long', local_name: 'long', label: 'xsd:long', description: 'A 64-bit signed integer' },
    ],
  },

  // ─── 2. Schema.org ─────────────────────────────────────────────────────
  {
    slug: 'schema-org',
    name: 'Schema.org',
    description: 'Schema.org core vocabulary — structured data for the web. Classes and properties for people, organizations, places, events, products, and more.',
    namespace: 'https://schema.org/',
    version: '26.0',
    category: 'community',
    is_always_on: true,
    dependencies: ['owl-rdfs-xsd'],
    items: [
      // Classes
      { item_type: 'class', uri: 'https://schema.org/Thing', local_name: 'Thing', label: 'schema:Thing', description: 'The most generic type of item' },
      { item_type: 'class', uri: 'https://schema.org/Person', local_name: 'Person', label: 'schema:Person', description: 'A person', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/Organization', local_name: 'Organization', label: 'schema:Organization', description: 'An organization', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/Place', local_name: 'Place', label: 'schema:Place', description: 'A physical place', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/Event', local_name: 'Event', label: 'schema:Event', description: 'An event happening at a certain time and location', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/CreativeWork', local_name: 'CreativeWork', label: 'schema:CreativeWork', description: 'The most generic kind of creative work', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/Product', local_name: 'Product', label: 'schema:Product', description: 'Any offered product or service', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/Action', local_name: 'Action', label: 'schema:Action', description: 'An action performed by an agent', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/Intangible', local_name: 'Intangible', label: 'schema:Intangible', description: 'A utility class for intangible things', parent_uri: 'https://schema.org/Thing' },
      { item_type: 'class', uri: 'https://schema.org/WebPage', local_name: 'WebPage', label: 'schema:WebPage', description: 'A web page', parent_uri: 'https://schema.org/CreativeWork' },
      { item_type: 'class', uri: 'https://schema.org/Article', local_name: 'Article', label: 'schema:Article', description: 'An article', parent_uri: 'https://schema.org/CreativeWork' },
      { item_type: 'class', uri: 'https://schema.org/Book', local_name: 'Book', label: 'schema:Book', description: 'A book', parent_uri: 'https://schema.org/CreativeWork' },
      { item_type: 'class', uri: 'https://schema.org/SoftwareApplication', local_name: 'SoftwareApplication', label: 'schema:SoftwareApplication', description: 'A software application', parent_uri: 'https://schema.org/CreativeWork' },
      { item_type: 'class', uri: 'https://schema.org/Dataset', local_name: 'Dataset', label: 'schema:Dataset', description: 'A body of structured data', parent_uri: 'https://schema.org/CreativeWork' },
      { item_type: 'class', uri: 'https://schema.org/MediaObject', local_name: 'MediaObject', label: 'schema:MediaObject', description: 'A media object (image, video, audio)', parent_uri: 'https://schema.org/CreativeWork' },
      { item_type: 'class', uri: 'https://schema.org/PostalAddress', local_name: 'PostalAddress', label: 'schema:PostalAddress', description: 'A mailing address', parent_uri: 'https://schema.org/Intangible' },
      { item_type: 'class', uri: 'https://schema.org/ContactPoint', local_name: 'ContactPoint', label: 'schema:ContactPoint', description: 'A contact point', parent_uri: 'https://schema.org/Intangible' },
      { item_type: 'class', uri: 'https://schema.org/Offer', local_name: 'Offer', label: 'schema:Offer', description: 'An offer to sell a product or service', parent_uri: 'https://schema.org/Intangible' },
      { item_type: 'class', uri: 'https://schema.org/QuantitativeValue', local_name: 'QuantitativeValue', label: 'schema:QuantitativeValue', description: 'A point value or interval for product characteristics', parent_uri: 'https://schema.org/Intangible' },
      { item_type: 'class', uri: 'https://schema.org/MonetaryAmount', local_name: 'MonetaryAmount', label: 'schema:MonetaryAmount', description: 'A monetary value', parent_uri: 'https://schema.org/Intangible' },
      // Properties
      { item_type: 'property', uri: 'https://schema.org/name', local_name: 'name', label: 'schema:name', description: 'The name of the item', domain_uri: 'https://schema.org/Thing', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/description', local_name: 'description', label: 'schema:description', description: 'A description of the item', domain_uri: 'https://schema.org/Thing', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/url', local_name: 'url', label: 'schema:url', description: 'URL of the item', domain_uri: 'https://schema.org/Thing', range_uri: 'http://www.w3.org/2001/XMLSchema#anyURI' },
      { item_type: 'property', uri: 'https://schema.org/image', local_name: 'image', label: 'schema:image', description: 'An image of the item', domain_uri: 'https://schema.org/Thing', range_uri: 'http://www.w3.org/2001/XMLSchema#anyURI' },
      { item_type: 'property', uri: 'https://schema.org/identifier', local_name: 'identifier', label: 'schema:identifier', description: 'An identifier for the item', domain_uri: 'https://schema.org/Thing', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/email', local_name: 'email', label: 'schema:email', description: 'Email address', domain_uri: 'https://schema.org/Person', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/telephone', local_name: 'telephone', label: 'schema:telephone', description: 'Telephone number', domain_uri: 'https://schema.org/Person', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/givenName', local_name: 'givenName', label: 'schema:givenName', description: 'Given name (first name)', domain_uri: 'https://schema.org/Person', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/familyName', local_name: 'familyName', label: 'schema:familyName', description: 'Family name (last name)', domain_uri: 'https://schema.org/Person', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/jobTitle', local_name: 'jobTitle', label: 'schema:jobTitle', description: 'Job title', domain_uri: 'https://schema.org/Person', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/birthDate', local_name: 'birthDate', label: 'schema:birthDate', description: 'Date of birth', domain_uri: 'https://schema.org/Person', range_uri: 'http://www.w3.org/2001/XMLSchema#date' },
      { item_type: 'property', uri: 'https://schema.org/address', local_name: 'address', label: 'schema:address', description: 'Physical address', domain_uri: 'https://schema.org/Thing', range_uri: 'https://schema.org/PostalAddress' },
      { item_type: 'property', uri: 'https://schema.org/memberOf', local_name: 'memberOf', label: 'schema:memberOf', description: 'An organization the person is a member of', domain_uri: 'https://schema.org/Person', range_uri: 'https://schema.org/Organization' },
      { item_type: 'property', uri: 'https://schema.org/worksFor', local_name: 'worksFor', label: 'schema:worksFor', description: 'Organization this person works for', domain_uri: 'https://schema.org/Person', range_uri: 'https://schema.org/Organization' },
      { item_type: 'property', uri: 'https://schema.org/founder', local_name: 'founder', label: 'schema:founder', description: 'A person who founded this organization', domain_uri: 'https://schema.org/Organization', range_uri: 'https://schema.org/Person' },
      { item_type: 'property', uri: 'https://schema.org/location', local_name: 'location', label: 'schema:location', description: 'The location of the event, organization, or action', domain_uri: 'https://schema.org/Event', range_uri: 'https://schema.org/Place' },
      { item_type: 'property', uri: 'https://schema.org/startDate', local_name: 'startDate', label: 'schema:startDate', description: 'The start date and time', domain_uri: 'https://schema.org/Event', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'https://schema.org/endDate', local_name: 'endDate', label: 'schema:endDate', description: 'The end date and time', domain_uri: 'https://schema.org/Event', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'https://schema.org/author', local_name: 'author', label: 'schema:author', description: 'The author of this creative work', domain_uri: 'https://schema.org/CreativeWork', range_uri: 'https://schema.org/Person' },
      { item_type: 'property', uri: 'https://schema.org/datePublished', local_name: 'datePublished', label: 'schema:datePublished', description: 'Date of first publication', domain_uri: 'https://schema.org/CreativeWork', range_uri: 'http://www.w3.org/2001/XMLSchema#date' },
      { item_type: 'property', uri: 'https://schema.org/dateCreated', local_name: 'dateCreated', label: 'schema:dateCreated', description: 'Date of creation', domain_uri: 'https://schema.org/CreativeWork', range_uri: 'http://www.w3.org/2001/XMLSchema#date' },
      { item_type: 'property', uri: 'https://schema.org/inLanguage', local_name: 'inLanguage', label: 'schema:inLanguage', description: 'The language of the content', domain_uri: 'https://schema.org/CreativeWork', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/price', local_name: 'price', label: 'schema:price', description: 'The offer price', domain_uri: 'https://schema.org/Offer', range_uri: 'http://www.w3.org/2001/XMLSchema#decimal' },
      { item_type: 'property', uri: 'https://schema.org/priceCurrency', local_name: 'priceCurrency', label: 'schema:priceCurrency', description: 'The currency of the price', domain_uri: 'https://schema.org/Offer', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'https://schema.org/sameAs', local_name: 'sameAs', label: 'schema:sameAs', description: 'URL of a reference web page that identifies the item', domain_uri: 'https://schema.org/Thing', range_uri: 'http://www.w3.org/2001/XMLSchema#anyURI' },
      { item_type: 'property', uri: 'https://schema.org/alternateName', local_name: 'alternateName', label: 'schema:alternateName', description: 'An alias for the item', domain_uri: 'https://schema.org/Thing', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
    ],
  },

  // ─── 3. SKOS ───────────────────────────────────────────────────────────
  {
    slug: 'skos',
    name: 'SKOS',
    description: 'Simple Knowledge Organization System — for taxonomies, thesauri, and controlled vocabularies.',
    namespace: 'http://www.w3.org/2004/02/skos/core#',
    version: '1.0',
    category: 'w3c',
    is_always_on: true,
    dependencies: ['owl-rdfs-xsd'],
    items: [
      // Classes
      { item_type: 'class', uri: 'http://www.w3.org/2004/02/skos/core#Concept', local_name: 'Concept', label: 'skos:Concept', description: 'A SKOS concept — a unit of thought' },
      { item_type: 'class', uri: 'http://www.w3.org/2004/02/skos/core#ConceptScheme', local_name: 'ConceptScheme', label: 'skos:ConceptScheme', description: 'A set of concepts, optionally with semantic relations' },
      { item_type: 'class', uri: 'http://www.w3.org/2004/02/skos/core#Collection', local_name: 'Collection', label: 'skos:Collection', description: 'A labeled and/or ordered group of SKOS concepts' },
      { item_type: 'class', uri: 'http://www.w3.org/2004/02/skos/core#OrderedCollection', local_name: 'OrderedCollection', label: 'skos:OrderedCollection', description: 'An ordered group of SKOS concepts' },
      // Labeling properties
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#prefLabel', local_name: 'prefLabel', label: 'skos:prefLabel', description: 'The preferred lexical label', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#altLabel', local_name: 'altLabel', label: 'skos:altLabel', description: 'An alternative lexical label', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#hiddenLabel', local_name: 'hiddenLabel', label: 'skos:hiddenLabel', description: 'A hidden lexical label (for search)', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      // Semantic relations
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#broader', local_name: 'broader', label: 'skos:broader', description: 'Relates a concept to a more general concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#narrower', local_name: 'narrower', label: 'skos:narrower', description: 'Relates a concept to a more specific concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#related', local_name: 'related', label: 'skos:related', description: 'Relates a concept to an associatively related concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#broaderTransitive', local_name: 'broaderTransitive', label: 'skos:broaderTransitive', description: 'Transitive broader relation', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#narrowerTransitive', local_name: 'narrowerTransitive', label: 'skos:narrowerTransitive', description: 'Transitive narrower relation', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      // Scheme relations
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#inScheme', local_name: 'inScheme', label: 'skos:inScheme', description: 'Relates a concept to the scheme it belongs to', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#ConceptScheme' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#hasTopConcept', local_name: 'hasTopConcept', label: 'skos:hasTopConcept', description: 'Relates a scheme to a top concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#ConceptScheme', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#topConceptOf', local_name: 'topConceptOf', label: 'skos:topConceptOf', description: 'Relates a concept to a scheme where it is a top concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#ConceptScheme' },
      // Documentation
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#definition', local_name: 'definition', label: 'skos:definition', description: 'A formal explanation of a concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#example', local_name: 'example', label: 'skos:example', description: 'An example of the use of a concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#note', local_name: 'note', label: 'skos:note', description: 'A general note about a concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#scopeNote', local_name: 'scopeNote', label: 'skos:scopeNote', description: 'A note about the scope of a concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#historyNote', local_name: 'historyNote', label: 'skos:historyNote', description: 'A note about the history of a concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#editorialNote', local_name: 'editorialNote', label: 'skos:editorialNote', description: 'A note for editors', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#changeNote', local_name: 'changeNote', label: 'skos:changeNote', description: 'A note documenting a change', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      // Mapping
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#exactMatch', local_name: 'exactMatch', label: 'skos:exactMatch', description: 'An exact equivalence mapping to a concept in another scheme', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#closeMatch', local_name: 'closeMatch', label: 'skos:closeMatch', description: 'A close equivalence mapping', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#broadMatch', local_name: 'broadMatch', label: 'skos:broadMatch', description: 'A broader mapping to a concept in another scheme', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#narrowMatch', local_name: 'narrowMatch', label: 'skos:narrowMatch', description: 'A narrower mapping to a concept in another scheme', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      // Collection
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#member', local_name: 'member', label: 'skos:member', description: 'Relates a collection to one of its members', domain_uri: 'http://www.w3.org/2004/02/skos/core#Collection', range_uri: 'http://www.w3.org/2004/02/skos/core#Concept' },
      { item_type: 'property', uri: 'http://www.w3.org/2004/02/skos/core#notation', local_name: 'notation', label: 'skos:notation', description: 'A notation, code, or other identifier for a concept', domain_uri: 'http://www.w3.org/2004/02/skos/core#Concept', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
    ],
  },

  // ─── 4. Dublin Core ────────────────────────────────────────────────────
  {
    slug: 'dublin-core',
    name: 'Dublin Core',
    description: 'Dublin Core Metadata Terms — a standardized vocabulary for describing resources (documents, web pages, media, etc.).',
    namespace: 'http://purl.org/dc/terms/',
    version: '1.1',
    category: 'community',
    is_always_on: true,
    dependencies: ['owl-rdfs-xsd'],
    items: [
      // Classes
      { item_type: 'class', uri: 'http://purl.org/dc/terms/Agent', local_name: 'Agent', label: 'dcterms:Agent', description: 'A resource that acts or has the power to act (person, organization, software)' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/BibliographicResource', local_name: 'BibliographicResource', label: 'dcterms:BibliographicResource', description: 'A book, article, or other documentary resource' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/FileFormat', local_name: 'FileFormat', label: 'dcterms:FileFormat', description: 'A digital resource format' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/Frequency', local_name: 'Frequency', label: 'dcterms:Frequency', description: 'A rate at which something recurs' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/Jurisdiction', local_name: 'Jurisdiction', label: 'dcterms:Jurisdiction', description: 'The extent or range of judicial authority' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/LicenseDocument', local_name: 'LicenseDocument', label: 'dcterms:LicenseDocument', description: 'A legal document giving official permission' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/LinguisticSystem', local_name: 'LinguisticSystem', label: 'dcterms:LinguisticSystem', description: 'A system of signs, symbols, sounds for communication' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/Location', local_name: 'Location', label: 'dcterms:Location', description: 'A spatial region or named place' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/MediaType', local_name: 'MediaType', label: 'dcterms:MediaType', description: 'A file format or physical medium' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/PeriodOfTime', local_name: 'PeriodOfTime', label: 'dcterms:PeriodOfTime', description: 'An interval of time' },
      { item_type: 'class', uri: 'http://purl.org/dc/terms/Standard', local_name: 'Standard', label: 'dcterms:Standard', description: 'A basis for comparison' },
      // Properties
      { item_type: 'property', uri: 'http://purl.org/dc/terms/title', local_name: 'title', label: 'dcterms:title', description: 'A name given to the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/creator', local_name: 'creator', label: 'dcterms:creator', description: 'An entity primarily responsible for making the resource', range_uri: 'http://purl.org/dc/terms/Agent' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/subject', local_name: 'subject', label: 'dcterms:subject', description: 'The topic of the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/description', local_name: 'description', label: 'dcterms:description', description: 'An account of the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/publisher', local_name: 'publisher', label: 'dcterms:publisher', description: 'An entity responsible for making the resource available', range_uri: 'http://purl.org/dc/terms/Agent' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/contributor', local_name: 'contributor', label: 'dcterms:contributor', description: 'An entity responsible for contributions to the resource', range_uri: 'http://purl.org/dc/terms/Agent' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/date', local_name: 'date', label: 'dcterms:date', description: 'A date associated with the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#date' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/type', local_name: 'type', label: 'dcterms:type', description: 'The nature or genre of the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/format', local_name: 'format', label: 'dcterms:format', description: 'The file format or physical medium', range_uri: 'http://purl.org/dc/terms/MediaType' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/identifier', local_name: 'identifier', label: 'dcterms:identifier', description: 'An unambiguous reference to the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/source', local_name: 'source', label: 'dcterms:source', description: 'A related resource from which this is derived', range_uri: 'http://www.w3.org/2001/XMLSchema#anyURI' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/language', local_name: 'language', label: 'dcterms:language', description: 'A language of the resource', range_uri: 'http://purl.org/dc/terms/LinguisticSystem' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/rights', local_name: 'rights', label: 'dcterms:rights', description: 'Information about rights held in and over the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/license', local_name: 'license', label: 'dcterms:license', description: 'A legal document under which the resource is made available', range_uri: 'http://purl.org/dc/terms/LicenseDocument' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/created', local_name: 'created', label: 'dcterms:created', description: 'Date of creation of the resource', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'http://purl.org/dc/terms/modified', local_name: 'modified', label: 'dcterms:modified', description: 'Date on which the resource was changed', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
    ],
  },

  // ─── 5. PROV-O ─────────────────────────────────────────────────────────
  {
    slug: 'prov-o',
    name: 'PROV-O',
    description: 'W3C Provenance Ontology — track the origin and history of data: who created it, when, from what, and how.',
    namespace: 'http://www.w3.org/ns/prov#',
    version: '1.0',
    category: 'w3c',
    is_always_on: true,
    dependencies: ['owl-rdfs-xsd'],
    items: [
      // Starting-point classes
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Entity', local_name: 'Entity', label: 'prov:Entity', description: 'A physical, digital, conceptual, or other kind of thing with some fixed aspects' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Activity', local_name: 'Activity', label: 'prov:Activity', description: 'Something that occurs over a period of time and acts upon entities' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Agent', local_name: 'Agent', label: 'prov:Agent', description: 'Something that bears some form of responsibility for an activity or entity' },
      // Expanded classes
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Collection', local_name: 'Collection', label: 'prov:Collection', description: 'A collection of entities', parent_uri: 'http://www.w3.org/ns/prov#Entity' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Bundle', local_name: 'Bundle', label: 'prov:Bundle', description: 'A named set of provenance descriptions', parent_uri: 'http://www.w3.org/ns/prov#Entity' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Plan', local_name: 'Plan', label: 'prov:Plan', description: 'A set of actions or steps intended by agents', parent_uri: 'http://www.w3.org/ns/prov#Entity' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Person', local_name: 'Person', label: 'prov:Person', description: 'A person agent', parent_uri: 'http://www.w3.org/ns/prov#Agent' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#SoftwareAgent', local_name: 'SoftwareAgent', label: 'prov:SoftwareAgent', description: 'A software agent', parent_uri: 'http://www.w3.org/ns/prov#Agent' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/prov#Organization', local_name: 'Organization', label: 'prov:Organization', description: 'An organization agent', parent_uri: 'http://www.w3.org/ns/prov#Agent' },
      // Starting-point properties
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#wasGeneratedBy', local_name: 'wasGeneratedBy', label: 'prov:wasGeneratedBy', description: 'The activity that generated this entity', domain_uri: 'http://www.w3.org/ns/prov#Entity', range_uri: 'http://www.w3.org/ns/prov#Activity' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#wasDerivedFrom', local_name: 'wasDerivedFrom', label: 'prov:wasDerivedFrom', description: 'The entity from which this entity was derived', domain_uri: 'http://www.w3.org/ns/prov#Entity', range_uri: 'http://www.w3.org/ns/prov#Entity' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#wasAttributedTo', local_name: 'wasAttributedTo', label: 'prov:wasAttributedTo', description: 'The agent to whom this entity is attributed', domain_uri: 'http://www.w3.org/ns/prov#Entity', range_uri: 'http://www.w3.org/ns/prov#Agent' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#used', local_name: 'used', label: 'prov:used', description: 'An entity used by this activity', domain_uri: 'http://www.w3.org/ns/prov#Activity', range_uri: 'http://www.w3.org/ns/prov#Entity' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#wasAssociatedWith', local_name: 'wasAssociatedWith', label: 'prov:wasAssociatedWith', description: 'An agent associated with this activity', domain_uri: 'http://www.w3.org/ns/prov#Activity', range_uri: 'http://www.w3.org/ns/prov#Agent' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#actedOnBehalfOf', local_name: 'actedOnBehalfOf', label: 'prov:actedOnBehalfOf', description: 'An agent that this agent acted on behalf of', domain_uri: 'http://www.w3.org/ns/prov#Agent', range_uri: 'http://www.w3.org/ns/prov#Agent' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#wasInformedBy', local_name: 'wasInformedBy', label: 'prov:wasInformedBy', description: 'The activity that informed this activity', domain_uri: 'http://www.w3.org/ns/prov#Activity', range_uri: 'http://www.w3.org/ns/prov#Activity' },
      // Temporal properties
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#startedAtTime', local_name: 'startedAtTime', label: 'prov:startedAtTime', description: 'The time at which an activity started', domain_uri: 'http://www.w3.org/ns/prov#Activity', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#endedAtTime', local_name: 'endedAtTime', label: 'prov:endedAtTime', description: 'The time at which an activity ended', domain_uri: 'http://www.w3.org/ns/prov#Activity', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#generatedAtTime', local_name: 'generatedAtTime', label: 'prov:generatedAtTime', description: 'The time at which an entity was generated', domain_uri: 'http://www.w3.org/ns/prov#Entity', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#invalidatedAtTime', local_name: 'invalidatedAtTime', label: 'prov:invalidatedAtTime', description: 'The time at which an entity was invalidated', domain_uri: 'http://www.w3.org/ns/prov#Entity', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#value', local_name: 'value', label: 'prov:value', description: 'A direct representation of an entity as a value', domain_uri: 'http://www.w3.org/ns/prov#Entity', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/prov#hadPrimarySource', local_name: 'hadPrimarySource', label: 'prov:hadPrimarySource', description: 'The primary source from which the entity was derived', domain_uri: 'http://www.w3.org/ns/prov#Entity', range_uri: 'http://www.w3.org/ns/prov#Entity' },
    ],
  },

  // ─── 6. OWL-Time ───────────────────────────────────────────────────────
  {
    slug: 'owl-time',
    name: 'OWL-Time',
    description: 'W3C Time Ontology in OWL — temporal entities, instants, intervals, durations, and their ordering relations.',
    namespace: 'http://www.w3.org/2006/time#',
    version: '1.0',
    category: 'w3c',
    is_always_on: false,
    dependencies: ['owl-rdfs-xsd'],
    items: [
      // Classes
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#TemporalEntity', local_name: 'TemporalEntity', label: 'time:TemporalEntity', description: 'A temporal interval or instant' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#Instant', local_name: 'Instant', label: 'time:Instant', description: 'A temporal entity with zero extent', parent_uri: 'http://www.w3.org/2006/time#TemporalEntity' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#Interval', local_name: 'Interval', label: 'time:Interval', description: 'A temporal entity with non-zero extent', parent_uri: 'http://www.w3.org/2006/time#TemporalEntity' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#ProperInterval', local_name: 'ProperInterval', label: 'time:ProperInterval', description: 'An interval with non-zero duration', parent_uri: 'http://www.w3.org/2006/time#Interval' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#Duration', local_name: 'Duration', label: 'time:Duration', description: 'A temporal duration (length of time)' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#DurationDescription', local_name: 'DurationDescription', label: 'time:DurationDescription', description: 'A description of a temporal duration in calendar terms', parent_uri: 'http://www.w3.org/2006/time#Duration' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#TemporalDuration', local_name: 'TemporalDuration', label: 'time:TemporalDuration', description: 'An abstract temporal duration' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#DateTimeDescription', local_name: 'DateTimeDescription', label: 'time:DateTimeDescription', description: 'A description of date and time structured with calendar components' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#TemporalPosition', local_name: 'TemporalPosition', label: 'time:TemporalPosition', description: 'A position on a timeline' },
      { item_type: 'class', uri: 'http://www.w3.org/2006/time#TimeZone', local_name: 'TimeZone', label: 'time:TimeZone', description: 'A timezone' },
      // Properties
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#hasBeginning', local_name: 'hasBeginning', label: 'time:hasBeginning', description: 'The beginning instant of a temporal entity', domain_uri: 'http://www.w3.org/2006/time#TemporalEntity', range_uri: 'http://www.w3.org/2006/time#Instant' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#hasEnd', local_name: 'hasEnd', label: 'time:hasEnd', description: 'The ending instant of a temporal entity', domain_uri: 'http://www.w3.org/2006/time#TemporalEntity', range_uri: 'http://www.w3.org/2006/time#Instant' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#hasDuration', local_name: 'hasDuration', label: 'time:hasDuration', description: 'The duration of a temporal entity', domain_uri: 'http://www.w3.org/2006/time#TemporalEntity', range_uri: 'http://www.w3.org/2006/time#Duration' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#before', local_name: 'before', label: 'time:before', description: 'This temporal entity is before the other', domain_uri: 'http://www.w3.org/2006/time#TemporalEntity', range_uri: 'http://www.w3.org/2006/time#TemporalEntity' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#after', local_name: 'after', label: 'time:after', description: 'This temporal entity is after the other', domain_uri: 'http://www.w3.org/2006/time#TemporalEntity', range_uri: 'http://www.w3.org/2006/time#TemporalEntity' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#inside', local_name: 'inside', label: 'time:inside', description: 'An instant inside a temporal entity', domain_uri: 'http://www.w3.org/2006/time#Interval', range_uri: 'http://www.w3.org/2006/time#Instant' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#inXSDDateTimeStamp', local_name: 'inXSDDateTimeStamp', label: 'time:inXSDDateTimeStamp', description: 'Position expressed as an XSD dateTimeStamp', domain_uri: 'http://www.w3.org/2006/time#Instant', range_uri: 'http://www.w3.org/2001/XMLSchema#dateTime' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#inTimePosition', local_name: 'inTimePosition', label: 'time:inTimePosition', description: 'Position expressed using a TemporalPosition', domain_uri: 'http://www.w3.org/2006/time#Instant', range_uri: 'http://www.w3.org/2006/time#TemporalPosition' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#years', local_name: 'years', label: 'time:years', description: 'The number of years in a duration', domain_uri: 'http://www.w3.org/2006/time#DurationDescription', range_uri: 'http://www.w3.org/2001/XMLSchema#decimal' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#months', local_name: 'months', label: 'time:months', description: 'The number of months in a duration', domain_uri: 'http://www.w3.org/2006/time#DurationDescription', range_uri: 'http://www.w3.org/2001/XMLSchema#decimal' },
      { item_type: 'property', uri: 'http://www.w3.org/2006/time#days', local_name: 'days', label: 'time:days', description: 'The number of days in a duration', domain_uri: 'http://www.w3.org/2006/time#DurationDescription', range_uri: 'http://www.w3.org/2001/XMLSchema#decimal' },
    ],
  },

  // ─── 7. W3C Organization Ontology ──────────────────────────────────────
  {
    slug: 'w3c-org',
    name: 'W3C Organization',
    description: 'W3C Organization Ontology — organizational structures, roles, memberships, and reporting relationships.',
    namespace: 'http://www.w3.org/ns/org#',
    version: '1.0',
    category: 'w3c',
    is_always_on: false,
    dependencies: ['owl-rdfs-xsd'],
    items: [
      // Classes
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#Organization', local_name: 'Organization', label: 'org:Organization', description: 'A collection of people organized together into a community or other social, commercial, or political structure' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#FormalOrganization', local_name: 'FormalOrganization', label: 'org:FormalOrganization', description: 'An organization recognized in the world at large (legally or socially)', parent_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#OrganizationalUnit', local_name: 'OrganizationalUnit', label: 'org:OrganizationalUnit', description: 'An organization such as a department within a larger organization', parent_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#OrganizationalCollaboration', local_name: 'OrganizationalCollaboration', label: 'org:OrganizationalCollaboration', description: 'A collaboration between two or more organizations', parent_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#Role', local_name: 'Role', label: 'org:Role', description: 'Denotes a role that a person or agent plays in an organization' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#Membership', local_name: 'Membership', label: 'org:Membership', description: 'An n-ary relationship between an agent, an organization, and a role' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#Site', local_name: 'Site', label: 'org:Site', description: 'An office or other premise at which an organization is located' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#Post', local_name: 'Post', label: 'org:Post', description: 'A position or function within an organization' },
      { item_type: 'class', uri: 'http://www.w3.org/ns/org#ChangeEvent', local_name: 'ChangeEvent', label: 'org:ChangeEvent', description: 'An event which resulted in a major change to an organization' },
      // Properties
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#memberOf', local_name: 'memberOf', label: 'org:memberOf', description: 'The organization to which a person belongs', range_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#hasMember', local_name: 'hasMember', label: 'org:hasMember', description: 'A person who is a member of this organization', domain_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#reportsTo', local_name: 'reportsTo', label: 'org:reportsTo', description: 'The post or person that this post reports to' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#hasUnit', local_name: 'hasUnit', label: 'org:hasUnit', description: 'An organizational unit within this organization', domain_uri: 'http://www.w3.org/ns/org#Organization', range_uri: 'http://www.w3.org/ns/org#OrganizationalUnit' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#unitOf', local_name: 'unitOf', label: 'org:unitOf', description: 'The organization this unit belongs to', domain_uri: 'http://www.w3.org/ns/org#OrganizationalUnit', range_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#hasSubOrganization', local_name: 'hasSubOrganization', label: 'org:hasSubOrganization', description: 'A sub-organization of this organization', domain_uri: 'http://www.w3.org/ns/org#Organization', range_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#subOrganizationOf', local_name: 'subOrganizationOf', label: 'org:subOrganizationOf', description: 'The parent organization', domain_uri: 'http://www.w3.org/ns/org#Organization', range_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#purpose', local_name: 'purpose', label: 'org:purpose', description: 'The purpose of this organization', domain_uri: 'http://www.w3.org/ns/org#Organization', range_uri: 'http://www.w3.org/2001/XMLSchema#string' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#hasSite', local_name: 'hasSite', label: 'org:hasSite', description: 'A site at which this organization is located', domain_uri: 'http://www.w3.org/ns/org#Organization', range_uri: 'http://www.w3.org/ns/org#Site' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#siteOf', local_name: 'siteOf', label: 'org:siteOf', description: 'The organization located at this site', domain_uri: 'http://www.w3.org/ns/org#Site', range_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#role', local_name: 'role', label: 'org:role', description: 'The role in a membership', domain_uri: 'http://www.w3.org/ns/org#Membership', range_uri: 'http://www.w3.org/ns/org#Role' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#member', local_name: 'member', label: 'org:member', description: 'The agent involved in a membership', domain_uri: 'http://www.w3.org/ns/org#Membership' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#organization', local_name: 'organization', label: 'org:organization', description: 'The organization involved in a membership', domain_uri: 'http://www.w3.org/ns/org#Membership', range_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#headOf', local_name: 'headOf', label: 'org:headOf', description: 'The organization this person heads', range_uri: 'http://www.w3.org/ns/org#Organization' },
      { item_type: 'property', uri: 'http://www.w3.org/ns/org#changedBy', local_name: 'changedBy', label: 'org:changedBy', description: 'An event which changed this organization', domain_uri: 'http://www.w3.org/ns/org#Organization', range_uri: 'http://www.w3.org/ns/org#ChangeEvent' },
    ],
  },
];

export function seedBaseLayers(db: Database.Database): void {
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM onto_base_layers').get() as any).c;
  if (existingCount > 0) {
    return; // Already seeded — idempotent
  }

  const insertLayer = db.prepare(`
    INSERT INTO onto_base_layers (slug, name, description, namespace, version, category, is_always_on, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO onto_base_layer_items (layer_id, item_type, uri, local_name, label, description, parent_uri, domain_uri, range_uri, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
  `);

  const updateCount = db.prepare(`UPDATE onto_base_layers SET item_count = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const layer of LAYERS) {
      const result = insertLayer.run(
        layer.slug,
        layer.name,
        layer.description,
        layer.namespace,
        layer.version,
        layer.category,
        layer.is_always_on ? 1 : 0,
        JSON.stringify({ dependencies: layer.dependencies })
      );

      const layerId = Number(result.lastInsertRowid);

      for (const item of layer.items) {
        insertItem.run(
          layerId,
          item.item_type,
          item.uri,
          item.local_name,
          item.label,
          item.description || null,
          item.parent_uri || null,
          item.domain_uri || null,
          item.range_uri || null
        );
      }

      updateCount.run(layer.items.length, layerId);
    }
  });

  tx();
  console.log(`[ontologica] Seeded ${LAYERS.length} base ontology layers (${LAYERS.reduce((s, l) => s + l.items.length, 0)} items)`);
}
