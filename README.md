# Local RAG System

A complete implementation for building a local Retrieval-Augmented Generation (RAG) pipeline using MinerU, Annoy/FAISS, and LM Studio.

## Overview

This project implements a fully functional RAG system that can:
- Process PDF documents using MinerU
- Extract and chunk text content
- Generate embeddings using Sentence Transformers
- Perform similarity search with Annoy or FAISS
- Generate answers using local LLMs via LM Studio

## Features

- **PDF Processing**: Uses MinerU for high-quality PDF text extraction
- **Text Chunking**: Intelligently splits documents into manageable chunks
- **Embedding Generation**: Uses Sentence Transformers for semantic embeddings
- **Vector Storage**: Supports both Annoy (CPU-optimized) and FAISS (GPU/CPU)
- **Local LLM Integration**: Works with LM Studio for answer generation
- **Configurable**: All settings can be adjusted via `config.yaml`

## System Architecture

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   PDFs      │───▶│  MinerU      │───▶│ Text        │───▶│ Embedding   │
│             │    │  Processor   │    │ Splitter     │    │ Generator    │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                              │
                                                              ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  LM Studio  │◀──│ LLM Client   │◀───│ Query        │◀───│ Vector      │
│             │    │              │    │ Processor    │    │ Store        │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                              │
                                                              ▼
                                                    ┌──────────────┐
                                                    │ Similarity   │
                                                    │ Search       │
                                                    └──────────────┘
```

## Pipeline Flow

1. **PDF Processing**
   - MinerU processes PDF files and extracts text content
   - Output is saved as markdown and JSON files
   - Fallback to PyPDF2 if MinerU fails

2. **Text Chunking**
   - Documents are split into overlapping chunks
   - Intelligent sentence boundary detection
   - Metadata preservation for each chunk

3. **Embedding Generation**
   - Uses Sentence Transformers (all-MiniLM-L6-v2 by default)
   - GPU acceleration support
   - Batch processing for efficiency

4. **Vector Storage**
   - Choose between Annoy (CPU-optimized) or FAISS (GPU/CPU)
   - Index building and saving to disk
   - Fast similarity search capabilities

5. **Query Processing**
   - Question embedding generation
   - Similarity search in vector store
   - Relevant document retrieval

6. **Answer Generation**
   - Context preparation from retrieved documents
   - LLM prompt construction
   - Response generation via LM Studio

## Installation

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Install additional tools**:
   - [LM Studio](https://lmstudio.ai/) for local LLM inference
   - [MinerU](https://github.com/opendatalab/MinerU) for PDF processing

3. **Download MinerU models**:
   ```bash
   # Download pipeline models from HuggingFace (recommended)
   mineru-models-download --source huggingface --model_type pipeline
   
   # Download Vision-Language Models from HuggingFace
   mineru-models-download --source huggingface --model_type vlm
   
   # Download both pipeline and VLM models
   mineru-models-download --source huggingface --model_type all
   ```

## Configuration

All settings are managed through `config.yaml`:

```yaml
# Paths
pdf_dir: "data/raw_pdfs"
processed_dir: "data/processed"
vector_db_dir: "data/vectordb"

# Vector store
vector_store_type: "annoy"  # Can be "annoy" or "faiss"

# Annoy settings
n_neighbors: 5
n_trees: 10

# FAISS settings
faiss_index_type: "Flat"

# Embeddings
embedding_model: "all-MiniLM-L6-v2"

# Device
device: "cuda"  # or "cpu"

# LM Studio
lm_studio_host: "http://127.0.0.1:1234"
```

## Usage

### Building the Knowledge Base

```bash
# Process all PDFs in the default directory
python rag_system.py --action build

# Process PDFs in a specific directory
python rag_system.py --action build --pdf-dir "path/to/pdfs"

# Add a single PDF to existing index
python rag_system.py --action add --pdf-file "document.pdf"

# Clear the existing index
python rag_system.py --action clear
```

### Querying the System

```bash
# Ask a question
python rag_system.py --action query --question "What is the main topic of the documents?"

# Interactive mode
python rag_system.py --action query

# Query without LLM generation (just retrieve documents)
python rag_system.py --action query --question "What is mentioned about AI?" --no-llm

# Retrieve more documents
python rag_system.py --action query --question "What are the key points?" --k 10
```

### Programmatic Usage

```python
from rag_system import RAGConfig, RAGPipeline

# Initialize
config = RAGConfig()
rag = RAGPipeline(config)

# Query
result = rag.query("What is the document about?")
print("Answer:", result["answer"])
print("Sources:", result["sources"])
```

## Vector Store Comparison

### Annoy
- **Pros**: Fast CPU performance, easy installation on Windows, good accuracy
- **Cons**: No GPU support
- **Best for**: Windows users, CPU-only environments

### FAISS
- **Pros**: GPU acceleration, highly optimized, scalable
- **Cons**: Complex installation on Windows, slower CPU performance
- **Best for**: Linux users, GPU-equipped systems

## Performance Tips

1. **For Windows Users**: Use Annoy for best performance
2. **For Large Datasets**: Use FAISS with GPU support
3. **Chunk Size**: Adjust based on document types (default: 1000 chars)
4. **Embedding Model**: `all-MiniLM-L6-v2` for speed, `all-mpnet-base-v2` for quality
5. **Device**: Use `cuda` for GPU acceleration, `cpu` for CPU-only

## Directory Structure

```
Local RAG/
├── rag_system.py          # Main implementation
├── config.yaml            # Configuration file
├── requirements.txt       # Dependencies
├── data/
│   ├── raw_pdfs/          # Input PDF files
│   ├── processed/         # Processed documents
│   ├── vectordb/          # Vector database
│   └── mineru_output/     # MinerU output
└── README.md              # This file
```

## Troubleshooting

### Common Issues

1. **LM Studio Connection**: Ensure LM Studio is running and a model is loaded
2. **MinerU Installation**: Follow MinerU installation instructions for your OS
3. **GPU Support**: Install CUDA toolkit for GPU acceleration
4. **Memory Issues**: Reduce chunk size or batch size for large documents

### Error Messages

- `No models loaded`: Start LM Studio and load a model
- `CUDA out of memory`: Reduce batch size or use CPU
- `File not found`: Check file paths in config.yaml

## License

This project is open source and available under the MIT License.