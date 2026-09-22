"""
Local RAG System with MinerU, Annoy, and LM Studio
A complete implementation for building a local RAG pipeline
"""

import os
import sys
import json
import pickle
import hashlib
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import faiss
import requests
from sentence_transformers import SentenceTransformer
from tqdm import tqdm
import subprocess
import yaml

# Try to import Annoy, with fallback if not available
try:
    from annoy import AnnoyIndex
    ANNOY_AVAILABLE = True
except ImportError:
    ANNOY_AVAILABLE = False
    print("Warning: Annoy not available. Please install it with 'pip install annoy'")

os.environ["MINERU_MODEL_SOURCE"] = "local"  # Use HuggingFace

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ================== Configuration ==================
@dataclass
class RAGConfig:
    """Configuration for RAG system"""
    # Paths
    pdf_dir: str = "data/raw_pdfs"
    processed_dir: str = "data/processed"
    vector_db_dir: str = "data/vectordb"
    
    # MinerU settings
    mineru_output_dir: str = "data/mineru_output"
    mineru_backend: str = ""  # Backend for processing (vlm-transformers for best quality, "" for auto-detection)
    
    # Chunking settings
    chunk_size: int = 1000
    chunk_overlap: int = 200
    
    # Embedding settings
    embedding_model: str = "all-MiniLM-L6-v2"  # Or "all-mpnet-base-v2" for better quality
    embedding_dim: int = 384
    
    # Vector store settings
    vector_store_type: str = "annoy"  # Can be "annoy" or "faiss"
    
    # Annoy settings
    n_neighbors: int = 5
    n_trees: int = 10
    
    # FAISS settings (only used if vector_store_type is "faiss")
    faiss_index_type: str = "Flat"  # Can be "IVF" for large scale
    
    # Device settings
    device: str = "cuda"  # GPU processing ("cuda" or "cpu")

    # LM Studio settings
    lm_studio_host: str = "http://127.0.0.1:1234"
    lm_studio_endpoint: str = "/v1/chat/completions"
    model_name: str = "local-model"  # Will be replaced with actual model in LM Studio
    max_tokens: int = 1000
    temperature: float = 0.7
    
    def __post_init__(self):
        """Create directories if they don't exist"""
        for dir_path in [self.pdf_dir, self.processed_dir, self.vector_db_dir, self.mineru_output_dir]:
            Path(dir_path).mkdir(parents=True, exist_ok=True)


# ================== MinerU Wrapper ==================
class MinerUProcessor:
    """Wrapper for MinerU PDF processing"""
    
    def __init__(self, config: RAGConfig):
        self.config = config
        self.output_dir = Path(config.mineru_output_dir)
        
    def process_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        Process PDF using MinerU
        Returns extracted content in markdown and json format
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")
        
        # Create output directory for this PDF
        pdf_hash = hashlib.md5(pdf_path.name.encode()).hexdigest()[:8]
        output_path = self.output_dir / f"{pdf_path.stem}_{pdf_hash}"
        output_path.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Processing PDF with MinerU: {pdf_path.name}")
        
        try:
            # Build and run MinerU command
            # cmd = ["mineru", "-p", str(pdf_path), "-o", str(output_path), "-m", "auto", "-d", self.config.device]
            cmd = ["mineru", "-p", str(pdf_path), "-o", str(output_path)]
            if self.config.mineru_backend:
                cmd.extend(["-b", self.config.mineru_backend])

            result = subprocess.run(cmd, capture_output=True, text=True)
            logger.info(f"MinerU stdout: {result.stdout}")
            logger.info(f"MinerU stderr: {result.stderr}")

            if result.returncode != 0:
                logger.error(f"MinerU error: {result.stderr}")
                # Fallback to basic extraction
                return self._fallback_extraction(pdf_path)

            # Read extracted content - mineru creates a subdirectory with the PDF name
            # The directory structure is: output_path/PDF_NAME/[auto|vlm]/files
            logger.info(f"Debug: output_path = {output_path}")
            logger.info(f"Debug: pdf_path.stem = {pdf_path.stem}")
            pdf_subdir = output_path / pdf_path.stem
            auto_dir = pdf_subdir / "auto"
            vlm_dir = pdf_subdir / "vlm"

            logger.info(f"Debug: pdf_subdir = {pdf_subdir}")
            logger.info(f"Debug: auto_dir = {auto_dir}")
            logger.info(f"Debug: vlm_dir = {vlm_dir}")

            # Wait for mineru to finish creating directory structure
            import time
            max_wait_time = 10  # Reduced wait time to 10 seconds
            wait_start = time.time()

            while time.time() - wait_start < max_wait_time:
                if pdf_subdir.exists():
                    logger.info(f"Debug: pdf_subdir now exists after {time.time() - wait_start:.1f}s")
                    if pdf_subdir.iterdir():
                        logger.info(f"Contents of pdf_subdir: {list(pdf_subdir.iterdir())}")
                    break
                time.sleep(0.5)  # Check every 0.5 seconds

            logger.info(f"Debug: auto_dir exists = {auto_dir.exists()}")
            logger.info(f"Debug: vlm_dir exists = {vlm_dir.exists()}")

            # Check both auto and vlm directories for output files
            if auto_dir.exists() and (auto_dir / f"{pdf_path.stem}.md").exists():
                markdown_file = auto_dir / f"{pdf_path.stem}.md"
                json_file = auto_dir / f"{pdf_path.stem}_content_list.json"
                logger.info(f"Found files in auto_dir: {markdown_file}, {json_file}")
            elif vlm_dir.exists() and (vlm_dir / f"{pdf_path.stem}.md").exists():
                markdown_file = vlm_dir / f"{pdf_path.stem}.md"
                json_file = vlm_dir / f"{pdf_path.stem}_content_list.json"
                logger.info(f"Found files in vlm_dir: {markdown_file}, {json_file}")
            else:
                # Fallback if no output directories found
                markdown_file = None
                json_file = None
                logger.error(f"No output files found. auto_dir exists: {auto_dir.exists()}, vlm_dir exists: {vlm_dir.exists()}")
                if pdf_subdir.exists():
                    try:
                        contents = list(pdf_subdir.iterdir())
                        logger.error(f"Contents of pdf_subdir: {contents}")
                    except Exception as e:
                        logger.error(f"Error listing pdf_subdir contents: {e}")

            content = {
                "source": str(pdf_path),
                "markdown": "",
                "metadata": {},
                "extraction_date": datetime.now().isoformat()
            }

            if markdown_file and markdown_file.exists():
                with open(markdown_file, 'r', encoding='utf-8') as f:
                    content["markdown"] = f.read()

            if json_file and json_file.exists():
                with open(json_file, 'r', encoding='utf-8') as f:
                    content["metadata"] = json.load(f)

            # Check if content was actually extracted, trigger fallback if empty
            if not content["markdown"].strip():
                logger.warning(f"No content extracted by MinerU, using fallback extraction")
                return self._fallback_extraction(pdf_path)

            return content
            
        except Exception as e:
            logger.error(f"Error processing PDF {pdf_path}: {e}")
            return self._fallback_extraction(pdf_path)
    
    def _fallback_extraction(self, pdf_path: Path) -> Dict[str, Any]:
        """Fallback extraction using PyPDF2 if MinerU fails"""
        try:
            import PyPDF2
            
            text = ""
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page_num in range(len(pdf_reader.pages)):
                    page = pdf_reader.pages[page_num]
                    text += page.extract_text() + "\n\n"
            
            return {
                "source": str(pdf_path),
                "markdown": text,
                "metadata": {"pages": len(pdf_reader.pages)},
                "extraction_date": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Fallback extraction failed: {e}")
            return {
                "source": str(pdf_path),
                "markdown": "",
                "metadata": {},
                "extraction_date": datetime.now().isoformat()
            }


# ================== Text Splitter ==================
class TextSplitter:
    """Split text into chunks with overlap"""
    
    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200):
        if not 0 <= chunk_overlap < chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
    
    def split_text(self, text: str, metadata: Dict = None) -> List[Dict]:
        """
        Split text into chunks with metadata
        """
        if not text:
            return []
        
        # Simple character-based splitting (can be improved with sentence boundaries)
        chunks = []
        start = 0
        text_length = len(text)
        
        while start < text_length:
            end = min(start + self.chunk_size, text_length)
            
            # Try to find a sentence boundary
            if end < text_length:
                for sep in ['. ', '\n\n', '\n', ' ']:
                    last_sep = text.rfind(sep, start, end)
                    if last_sep != -1:
                        end = last_sep + len(sep)
                        break
            
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunk_metadata = metadata.copy() if metadata else {}
                chunk_metadata.update({
                    "chunk_index": len(chunks),
                    "start_char": start,
                    "end_char": end
                })
                
                chunks.append({
                    "text": chunk_text,
                    "metadata": chunk_metadata
                })
            
            if end == text_length:
                break
            # Update start position for next chunk
            previous_start = start
            start = end - self.chunk_overlap
            
            # Ensure we make progress to avoid infinite loop
            if start <= previous_start:
                start = end
                
            # Ensure start doesn't exceed text length
            if start >= text_length:
                break
                
        return chunks


# ================== Embedding Generator ==================
class EmbeddingGenerator:
    """Generate embeddings using Sentence Transformers"""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2", device: str = "cuda"):
        self.model_name = model_name
        self.device = device
        logger.info(f"Loading embedding model: {model_name} on device: {device}")
        self.model = SentenceTransformer(model_name, device=device)
        self.embedding_dim = self.model.get_sentence_embedding_dimension()
    
    def generate_embeddings(self, texts: List[str], batch_size: int = 32) -> np.ndarray:
        """Generate embeddings for a list of texts"""
        if not texts:
            return np.array([])
        
        logger.info(f"Generating embeddings for {len(texts)} texts")
        embeddings = self.model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=True,
            convert_to_numpy=True
        )
        return embeddings
    
    def generate_embedding(self, text: str) -> np.ndarray:
        """Generate embedding for a single text"""
        return self.model.encode([text], convert_to_numpy=True)[0]


# ================== FAISS Vector Store ==================
class FAISSVectorStore:
    """FAISS-based vector store for similarity search"""

    def __init__(self, config: RAGConfig):
        self.config = config
        self.index = None
        self.documents = []
        self.index_path = Path(config.vector_db_dir) / "faiss.index"
        self.docs_path = Path(config.vector_db_dir) / "faiss_documents.pkl"

    def create_index(self, embedding_dim: int):
        logger.info(f"FAISS: Creating new CPU index of type: {self.config.faiss_index_type}")
        if self.config.faiss_index_type == "Flat":
            self.index = faiss.IndexFlatL2(embedding_dim)
        elif self.config.faiss_index_type == "IVF":
            quantizer = faiss.IndexFlatL2(embedding_dim)
            self.index = faiss.IndexIVFFlat(quantizer, embedding_dim, 100)
        elif self.config.faiss_index_type == "IVFPQ":
            nlist = 100
            m = 8
            bits = 8
            quantizer = faiss.IndexFlatL2(embedding_dim)
            self.index = faiss.IndexIVFPQ(quantizer, embedding_dim, nlist, m, bits)
        else:
            raise ValueError(f"Unknown FAISS index type: {self.config.faiss_index_type}")

    def add_documents(self, embeddings: np.ndarray, documents: List[Dict]):
        if self.index is None: self.create_index(embeddings.shape[1])
        if "IVF" in self.config.faiss_index_type and not self.index.is_trained:
            logger.info(f"FAISS: Training index on {embeddings.shape[0]} vectors...")
            self.index.train(embeddings)
            logger.info("FAISS: Training complete.")
        logger.info(f"FAISS: Adding {len(documents)} documents to index (total: {self.index.ntotal + len(documents)}).")
        self.index.add(embeddings)
        self.documents.extend(documents)

    def search(self, query_embedding: np.ndarray, k: int = None) -> List[Dict]:
        if not self.index or self.index.ntotal == 0: return []
        k = k or self.config.n_neighbors
        k = min(k, self.index.ntotal)
        logger.info(f"FAISS: Searching for {k} nearest neighbors.")
        distances, indices = self.index.search(query_embedding.reshape(1, -1), k)
        results = [self.documents[i] | {"score": d} for d, i in zip(distances[0], indices[0]) if i != -1]
        logger.info(f"FAISS: Found {len(results)} results.")
        return results

    def save(self):
        if self.index:
            faiss.write_index(self.index, str(self.index_path))
            with open(self.docs_path, 'wb') as f: pickle.dump(self.documents, f)
            logger.info("FAISS: Vector store saved successfully.")

    def build_index(self):
        """FAISS indices are ready immediately after add_documents."""
        return None

    def load(self):
        if self.index_path.exists() and self.docs_path.exists():
            self.index = faiss.read_index(str(self.index_path))
            with open(self.docs_path, 'rb') as f: self.documents = pickle.load(f)
            logger.info(f"FAISS: Loaded index with {self.index.ntotal} vectors.")
            return True
        return False


# ================== Annoy Vector Store ==================
class AnnoyVectorStore:
    """Annoy-based vector store for similarity search"""

    def __init__(self, config: RAGConfig):
        if not ANNOY_AVAILABLE:
            raise ImportError("Annoy is not available. Please install it with 'pip install annoy'")
        
        self.config = config
        self.index = None
        self.documents = []
        self.embedding_dim = None
        self.built = False
        self.index_path = Path(config.vector_db_dir) / "annoy_index.ann"
        self.docs_path = Path(config.vector_db_dir) / "documents.pkl"
        self.meta_path = Path(config.vector_db_dir) / "index_meta.pkl"  # To store embedding dimension

    def create_index(self, embedding_dim: int):
        """Create Annoy index"""
        logger.info(f"Annoy: Creating new index with {embedding_dim} dimensions")
        self.embedding_dim = embedding_dim
        self.index = AnnoyIndex(embedding_dim, 'angular')  # Using angular distance
        self.built = False
        
    def add_documents(self, embeddings: np.ndarray, documents: List[Dict]):
        """Add documents to the vector store"""
        # If this is the first time adding documents, create the index
        if self.index is None:
            self.create_index(embeddings.shape[1])
        elif self.built:
            # A loaded/built Annoy index is immutable; rebuild from its vectors.
            previous = [self.index.get_item_vector(i) for i in range(len(self.documents))]
            self.create_index(self.embedding_dim)
            for i, vector in enumerate(previous):
                self.index.add_item(i, vector)
            
        # Add vectors to the index
        start_id = len(self.documents)
        for i, embedding in enumerate(embeddings):
            self.index.add_item(start_id + i, embedding)
            
        # Extend documents list
        self.documents.extend(documents)
        
        logger.info(f"Annoy: Added {len(documents)} documents to index (total: {len(self.documents)}).")

    def build_index(self, n_trees: int = None):
        """Build the Annoy index (needs to be called after adding all documents)"""
        if self.index is not None and not self.built:
            n_trees = n_trees or self.config.n_trees
            logger.info(f"Annoy: Building index with {n_trees} trees")
            self.index.build(n_trees)
            self.built = True
            
    def search(self, query_embedding: np.ndarray, k: int = None) -> List[Dict]:
        """Search for similar documents"""
        if self.index is None or len(self.documents) == 0:
            return []
            
        k = k or self.config.n_neighbors
        k = min(k, len(self.documents))
        
        logger.info(f"Annoy: Searching for {k} nearest neighbors.")
        
        # Perform search
        indices, distances = self.index.get_nns_by_vector(query_embedding, k, include_distances=True)
        
        # Format results
        results = []
        for i, (idx, dist) in enumerate(zip(indices, distances)):
            if idx < len(self.documents):
                doc = self.documents[idx].copy()
                doc["score"] = float(dist)
                results.append(doc)
        
        logger.info(f"Annoy: Found {len(results)} results.")
        return results

    def save(self):
        """Save the vector store to disk"""
        if self.index is not None:
            # Save index
            self.index.save(str(self.index_path))
            
            # Save documents
            with open(self.docs_path, 'wb') as f:
                pickle.dump(self.documents, f)
                
            # Save metadata (embedding dimension)
            with open(self.meta_path, 'wb') as f:
                pickle.dump({"embedding_dim": self.embedding_dim}, f)
                
            logger.info("Annoy: Vector store saved successfully.")

    def load(self):
        """Load the vector store from disk"""
        if self.index_path.exists() and self.docs_path.exists() and self.meta_path.exists():
            # Load metadata
            with open(self.meta_path, 'rb') as f:
                meta = pickle.load(f)
                self.embedding_dim = meta["embedding_dim"]
            
            # Create and load index
            self.index = AnnoyIndex(self.embedding_dim, 'angular')
            self.index.load(str(self.index_path))
            self.built = True
            
            # Load documents
            with open(self.docs_path, 'rb') as f:
                self.documents = pickle.load(f)
            
            logger.info(f"Annoy: Loaded index with {len(self.documents)} vectors.")
            return True
        return False


# ================== LM Studio Client ==================
class LMStudioClient:
    """Client for LM Studio local LLM"""
    
    def __init__(self, config: RAGConfig):
        self.config = config
        self.base_url = config.lm_studio_host
        self.endpoint = config.lm_studio_endpoint
        
    def generate(self, prompt: str, context: str = "", system_prompt: str = None) -> str:
        """Generate response using LM Studio"""
        
        # Default system prompt for RAG
        if system_prompt is None:
            system_prompt = """You are a helpful assistant that answers questions based on the provided context. 
            Use the context to provide accurate and relevant answers. If the context doesn't contain 
            relevant information, say so clearly."""
        
        # Prepare messages
        messages = [
            {"role": "system", "content": system_prompt}
        ]
        
        if context:
            user_message = f"Context:\n{context}\n\nQuestion: {prompt}"
        else:
            user_message = prompt
        
        messages.append({"role": "user", "content": user_message})
        
        # Prepare request
        payload = {
            "model": self.config.model_name,
            "messages": messages,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "stream": False
        }
        
        try:
            # Make request to LM Studio
            response = requests.post(
                f"{self.base_url}{self.endpoint}",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=(5, 180)
            )
            
            if response.status_code == 200:
                result = response.json()
                return result["choices"][0]["message"]["content"]
            else:
                logger.error(f"LM Studio error: {response.status_code} - {response.text}")
                return "Error: Failed to generate response from LM Studio"
                
        except requests.exceptions.ConnectionError:
            logger.error("Cannot connect to LM Studio. Make sure it's running on http://localhost:1234")
            return "Error: Cannot connect to LM Studio. Please ensure it's running."
        except Exception as e:
            logger.error(f"Error generating response: {e}")
            return f"Error: {str(e)}"


# ================== Main RAG Pipeline ==================
class RAGPipeline:
    """Main RAG pipeline orchestrator"""
    
    def __init__(self, config: RAGConfig = None):
        self.config = config or RAGConfig()
        
        # Initialize components
        self.mineru_processor = MinerUProcessor(self.config)
        self.text_splitter = TextSplitter(
            chunk_size=self.config.chunk_size,
            chunk_overlap=self.config.chunk_overlap
        )
        self.embedding_generator = EmbeddingGenerator(self.config.embedding_model, self.config.device)
        
        # Use the configured vector store
        if self.config.vector_store_type.lower() == "annoy":
            self.vector_store = AnnoyVectorStore(self.config)
        elif self.config.vector_store_type.lower() == "faiss":
            self.vector_store = FAISSVectorStore(self.config)
        else:
            raise ValueError(f"Unknown vector store type: {self.config.vector_store_type}. Use 'annoy' or 'faiss'.")
        
        self.llm_client = LMStudioClient(self.config)
        
        # Try to load existing index
        self.vector_store.load()
    
    def process_pdf(self, pdf_path: str):
        """Process a single PDF and add to vector store"""
        logger.info(f"Processing PDF: {pdf_path}")

        document_hash = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()
        if any(doc.get("metadata", {}).get("document_hash") == document_hash for doc in self.vector_store.documents):
            logger.info("PDF already indexed, skipping")
            return
        
        # Extract content with MinerU
        extracted = self.mineru_processor.process_pdf(pdf_path)
        
        if not extracted["markdown"]:
            logger.warning(f"No content extracted from {pdf_path}")
            return
        
        # Split into chunks
        chunks = self.text_splitter.split_text(
            extracted["markdown"],
            metadata={
                "source": extracted["source"],
                "document_hash": document_hash,
                "extraction_date": extracted["extraction_date"]
            }
        )
        
        if not chunks:
            logger.warning(f"No chunks created from {pdf_path}")
            return
        
        # Generate embeddings
        texts = [chunk["text"] for chunk in chunks]
        embeddings = self.embedding_generator.generate_embeddings(texts)
        
        # Add to vector store
        self.vector_store.add_documents(embeddings, chunks)
        
        logger.info(f"Successfully processed {pdf_path}: {len(chunks)} chunks added")
    
    def process_directory(self, directory: str = None):
        """Process all PDFs in a directory"""
        directory = directory or self.config.pdf_dir
        pdf_files = list(Path(directory).glob("*.pdf"))
        
        if not pdf_files:
            logger.warning(f"No PDF files found in {directory}")
            return
        
        logger.info(f"Found {len(pdf_files)} PDF files to process")
        
        for pdf_path in tqdm(pdf_files, desc="Processing PDFs"):
            try:
                self.process_pdf(str(pdf_path))
            except Exception as e:
                logger.error(f"Error processing {pdf_path}: {e}")
                continue
        
        # Build and save index
        self.vector_store.build_index()
        self.vector_store.save()
        logger.info("Processing complete and index saved")
    
    def query(self, question: str, k: int = None, use_llm: bool = True) -> Dict[str, Any]:
        """
        Query the RAG system
        
        Args:
            question: User's question
            k: Number of documents to retrieve
            use_llm: Whether to use LLM for generation or just return retrieved docs
        
        Returns:
            Dictionary with answer and retrieved documents
        """
        logger.info(f"Query: {question}")
        
        # Generate query embedding
        query_embedding = self.embedding_generator.generate_embedding(question)
        
        # Search for similar documents
        retrieved_docs = self.vector_store.search(query_embedding, k=k)
        
        if not retrieved_docs:
            return {
                "answer": "No relevant documents found in the knowledge base.",
                "retrieved_documents": [],
                "sources": []
            }
        
        # Prepare context from retrieved documents
        context_parts = []
        sources = []
        
        for i, doc in enumerate(retrieved_docs, 1):
            context_parts.append(f"[Document {i}]\n{doc['text']}\n")
            sources.append({
                "source": doc["metadata"].get("source", "Unknown"),
                "score": doc["score"],
                "rank": i  # Add rank for consistency
            })
        
        context = "\n".join(context_parts)
        
        # Generate answer using LLM
        if use_llm:
            answer = self.llm_client.generate(question, context)
        else:
            answer = "Retrieved documents (LLM generation disabled)"
        
        return {
            "answer": answer,
            "retrieved_documents": retrieved_docs,
            "sources": sources,
            "context": context
        }
    
    def add_pdf(self, pdf_path: str):
        """Add a single PDF to the existing index"""
        self.process_pdf(pdf_path)
        self.vector_store.build_index()
        self.vector_store.save()
    
    def clear_index(self):
        """Clear the vector store"""
        if isinstance(self.vector_store, AnnoyVectorStore) and self.vector_store.index is not None:
            self.vector_store.index.unload()
        self.vector_store.index = None
        self.vector_store.documents = []
        self.vector_store.embedding_dim = None
        self.vector_store.built = False
        for attribute in ("index_path", "docs_path", "meta_path"):
            path = getattr(self.vector_store, attribute, None)
            if path is not None:
                path.unlink(missing_ok=True)
        logger.info("Vector store cleared")


# ================== CLI Interface ==================
def main():
    """Main CLI interface"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Local RAG System")
    parser.add_argument("--action", choices=["build", "query", "add", "clear"], required=True,
                       help="Action to perform")
    parser.add_argument("--pdf-dir", help="Directory containing PDFs (for build)")
    parser.add_argument("--pdf-file", help="Single PDF file (for add)")
    parser.add_argument("--question", help="Question to ask (for query)")
    parser.add_argument("--k", type=int, default=5, help="Number of documents to retrieve")
    parser.add_argument("--no-llm", action="store_true", help="Disable LLM generation")
    parser.add_argument("--config", default=str(Path(__file__).with_name("config.yaml")))
    
    args = parser.parse_args()
    
    # Initialize RAG pipeline
    config = load_config(args.config)
    rag = RAGPipeline(config)
    
    if args.action == "build":
        # Build index from PDFs
        pdf_dir = args.pdf_dir or config.pdf_dir
        rag.process_directory(pdf_dir)
        
    elif args.action == "query":
        # Query the system
        if not args.question:
            question = input("Enter your question: ")
        else:
            question = args.question
        
        result = rag.query(question, k=args.k, use_llm=not args.no_llm)
        
        print("\n" + "="*50)
        print("ANSWER:")
        print("="*50)
        print(result["answer"])
        
        print("\n" + "="*50)
        print("SOURCES:")
        print("="*50)
        for source in result["sources"]:
            print(f"- {source['source']} (Score: {source['score']:.4f})")
        
    elif args.action == "add":
        # Add single PDF
        if not args.pdf_file:
            print("Please provide --pdf-file")
            return
        rag.add_pdf(args.pdf_file)
        
    elif args.action == "clear":
        # Clear index
        rag.clear_index()
        print("Index cleared")

def load_config(path):
    config_path = Path(path).resolve()
    with config_path.open(encoding="utf-8") as handle:
        values = yaml.safe_load(handle) or {}
    for name in ("pdf_dir", "processed_dir", "vector_db_dir", "mineru_output_dir"):
        if name in values and not Path(values[name]).is_absolute():
            values[name] = str(config_path.parent / values[name])
    return RAGConfig(**values)

if __name__ == "__main__":
    main()
