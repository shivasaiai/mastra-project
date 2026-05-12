# V2 Mermaid Architecture

This document is the visual version of the V2 design. It shows the end-to-end system, async ingestion, agent boundaries, retrieval strategy, and evidence flow.

## 1. System Context

```mermaid
flowchart TB
  user["User"]
  api["HTTP API<br/>/upload /chat /documents"]
  queue["In-process Job Queue<br/>Replaceable with durable queue"]
  worker["Document Worker"]
  store["Session Document Store<br/>manifest + originals + artifacts + indexes"]
  mastra["Mastra Runtime"]
  coordinator["Coordinator Agent"]
  analyst["Document Analyst Agent"]
  research["Research Agent"]
  tools["Typed Mastra Tools"]
  web["External Web Search"]

  user --> api
  api --> queue
  queue --> worker
  worker --> store
  api --> mastra
  mastra --> coordinator
  mastra --> analyst
  mastra --> research
  coordinator --> tools
  analyst --> tools
  research --> tools
  tools --> store
  tools --> web
```

## 2. Runtime Component Boundary

```mermaid
flowchart LR
  subgraph agents["Agents: reasoning and synthesis only"]
    coordinator["Coordinator Agent<br/>intent + routing + hybrid synthesis"]
    analyst["Document Analyst Agent<br/>document reasoning + evidence synthesis"]
    research["Research Agent<br/>source lookup + research synthesis"]
  end

  subgraph tools["Tools and Services: deterministic work"]
    upload["Upload Service"]
    jobs["Job Queue"]
    extractors["Extractors<br/>PDF DOCX PPTX Excel CSV"]
    indexers["Indexers<br/>text + future vector"]
    retrieval["Retrieval Tools<br/>search + spreadsheet query + slide tools"]
    evidence["Evidence Builder<br/>typed citations"]
  end

  coordinator --> analyst
  coordinator --> research
  analyst --> retrieval
  research --> retrieval
  upload --> jobs
  jobs --> extractors
  extractors --> indexers
  retrieval --> evidence
```

## 3. Agent Decision Flow

```mermaid
flowchart TD
  q["Incoming chat message"]
  classify{"Coordinator routeIntent"}
  doc["Document Analyst Agent"]
  web["Research Agent"]
  hybrid["Coordinator Agent<br/>merge document + web evidence"]
  status["Document status/list response"]
  answer["Final answer with citations"]

  q --> classify
  classify -->|"uploaded docs question"| doc
  classify -->|"external research question"| web
  classify -->|"needs both"| hybrid
  classify -->|"file/status question"| status
  doc --> answer
  web --> answer
  hybrid --> doc
  hybrid --> web
  hybrid --> answer
  status --> answer
```

## 4. Async Upload and Ingestion Flow

```mermaid
sequenceDiagram
  participant User
  participant API as HTTP API
  participant Upload as Upload Service
  participant Manifest as Manifest Store
  participant Queue as Job Queue
  participant Worker as Document Worker
  participant Extractor as File Extractor
  participant Indexer as Retrieval Indexer

  User->>API: POST /upload
  API->>Upload: initializeUpload(sourcePath, session)
  Upload->>Manifest: create file record status=queued
  Upload->>Queue: enqueue ExtractDocumentJob
  API-->>User: 202 fileId + jobId + status=queued

  Queue->>Worker: process job
  Worker->>Manifest: status=extracting
  Worker->>Extractor: parse original file
  Extractor-->>Worker: derived artifacts + warnings
  Worker->>Manifest: status=indexing
  Worker->>Indexer: build text index / future vector index
  Indexer-->>Worker: index paths
  Worker->>Manifest: status=ready or partial or failed
```

## 5. Document Status State Machine

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> extracting: worker starts
  extracting --> indexing: artifacts written
  indexing --> ready: all required indexes available
  indexing --> partial: usable evidence with warnings
  extracting --> failed: extraction error
  queued --> unsupported: unsupported file type
  ready --> [*]
  partial --> [*]
  failed --> [*]
  unsupported --> [*]
```

## 6. Artifact and Index Layout

```mermaid
flowchart TB
  session["data/users/userId/sessions/sessionId"]
  manifest["manifest.json<br/>source of truth"]
  uploads["uploads/fileId/original.ext<br/>immutable original"]
  extracted["extracted/"]
  pdf["pdf/fileId<br/>pages + document.md + structure"]
  docx["docx/fileId<br/>document.md + chunks"]
  pptx["pptx/fileId<br/>slides + deck + charts"]
  excel["excel/fileId<br/>workbook + schemas + rows"]
  indexes["indexes/"]
  text["text/fileId.chunks.jsonl"]
  vector["vector future path"]

  session --> manifest
  session --> uploads
  session --> extracted
  session --> indexes
  extracted --> pdf
  extracted --> docx
  extracted --> pptx
  extracted --> excel
  indexes --> text
  indexes --> vector
```

## 7. Retrieval Strategy by Document Type

```mermaid
flowchart LR
  question["User question"]
  router{"Document Analyst chooses retrieval path"}
  pdf["PDF<br/>page markdown + text index + optional vision"]
  docx["DOCX<br/>heading/block chunks + text index"]
  pptx["PPTX<br/>slide markdown + structure + chart data"]
  excel["Excel/CSV<br/>schema + preview + structured query"]
  evidence["EvidencePacket[]"]
  answer["Grounded answer"]

  question --> router
  router -->|"PDF question"| pdf
  router -->|"Word question"| docx
  router -->|"slide/deck question"| pptx
  router -->|"tabular question"| excel
  pdf --> evidence
  docx --> evidence
  pptx --> evidence
  excel --> evidence
  evidence --> answer
```

## 8. Text Retrieval Flow

```mermaid
sequenceDiagram
  participant Agent as Document Analyst Agent
  participant Tool as documents.searchText
  participant Index as Text Index
  participant Evidence as Evidence Builder

  Agent->>Tool: query + session + optional fileId
  Tool->>Index: load chunks jsonl
  Index-->>Tool: matching chunks with scores
  Tool->>Evidence: build EvidencePacket
  Evidence-->>Tool: cited evidence
  Tool-->>Agent: EvidencePacket[]
```

## 9. Spreadsheet Retrieval Flow

```mermaid
sequenceDiagram
  participant Agent as Document Analyst Agent
  participant Sheets as excel.listSheets
  participant Schema as excel.getSchema
  participant Query as excel.queryRows
  participant Evidence as Evidence Builder

  Agent->>Sheets: inspect workbook
  Sheets-->>Agent: sheets + ids
  Agent->>Schema: inspect target sheet columns
  Schema-->>Agent: inferred types + null counts
  Agent->>Query: filters + select + sort + limit
  Query->>Evidence: build row-level EvidencePacket
  Query-->>Agent: rows + EvidencePacket[]
```

## 10. Evidence Packet Model

```mermaid
classDiagram
  class EvidencePacket {
    string evidenceId
    Source source
    Locator locator
    Content content
    number score
    string extractionStatus
    string[] warnings
  }

  class Source {
    string userId
    string sessionId
    string fileId
    string originalFilename
    string documentType
  }

  class Locator {
    number page
    number slide
    string sheetId
    number rowNumber
    string column
    string blockId
    string chartId
  }

  class Content {
    string text
    object row
    object[] table
    string summary
  }

  EvidencePacket --> Source
  EvidencePacket --> Locator
  EvidencePacket --> Content
```

## 11. Hybrid Question Flow

```mermaid
sequenceDiagram
  participant User
  participant API as HTTP API
  participant Coord as Coordinator Agent
  participant Doc as Document Analyst Agent
  participant Research as Research Agent
  participant Tools as Typed Tools

  User->>API: Ask hybrid question
  API->>Coord: route=hybrid with session context
  Coord->>Doc: request uploaded-file evidence
  Doc->>Tools: document/search/spreadsheet tools
  Tools-->>Doc: EvidencePacket[]
  Doc-->>Coord: grounded document findings
  Coord->>Research: request external context
  Research->>Tools: research.searchWeb
  Tools-->>Research: source snippets
  Research-->>Coord: cited research findings
  Coord-->>API: merged answer with separated evidence types
  API-->>User: final answer
```

## 12. Module Map

```mermaid
flowchart TB
  api["src/server.ts"]
  agents["src/agents/"]
  mastra["src/mastra/"]
  ingestion["src/ingestion/"]
  extractors["src/extractors/"]
  retrieval["src/retrieval/"]
  services["src/services/"]
  store["src/document-store/"]
  types["src/types.ts"]

  api --> agents
  api --> ingestion
  api --> services
  agents --> mastra
  mastra --> services
  services --> retrieval
  ingestion --> extractors
  ingestion --> retrieval
  ingestion --> store
  extractors --> store
  retrieval --> store
  retrieval --> types
  services --> types
```

## 13. Interview Summary Diagram

```mermaid
flowchart LR
  principle["Principle:<br/>few agents, many reliable tools"]
  agents["Agents<br/>coordinate + reason + synthesize"]
  tools["Tools<br/>bounded deterministic operations"]
  artifacts["Artifacts<br/>markdown JSON rows indexes"]
  evidence["Evidence<br/>fileId + locator + status"]
  answer["Answer<br/>grounded + cited + explicit uncertainty"]

  principle --> agents
  principle --> tools
  tools --> artifacts
  artifacts --> evidence
  agents --> evidence
  evidence --> answer
```
