"""
Local RAG System with MinerU, FAISS, and LM Studio
A complete implementation for building a local RAG pipeline
"""

import os
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

os.environ["MINERU_MODEL_SOURCE"] = "local" #huggingface Use HuggingFace  

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
    mineru_backend: str = ""  # Backend for GPU acceleration vlm-transformers
    
    # Chunking settings
    chunk_size: int = 1000
    chunk_overlap: int = 200
    
    # Embedding settings
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_dim: int = 384
    
    # FAISS settings
    faiss_index_type: str = "Flat"  # Can be "IVF" for large scale
    n_neighbors: int = 5
    
    # Device settings
    device: str = "cuda"  # Device for GPU processing ("cuda" or "cpu")

    # LM Studio settings
    lm_studio_host: str = "http://localhost:1234"
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
            cmd = ["mineru", "-p", str(pdf_path), "-o", str(output_path), "-m", "auto", "-d", self.config.device]
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
            max_wait_time = 30  # Wait up to 30 seconds for mineru to create directories
            wait_start = time.time()

            while time.time() - wait_start < max_wait_time:
                if pdf_subdir.exists():
                    logger.info(f"Debug: pdf_subdir now exists after {time.time() - wait_start:.1f}s")
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
                    logger.error(f"Contents of pdf_subdir: {list(pdf_subdir.iterdir())}")

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
            
            start = end - self.chunk_overlap
            if start < 0:
                start = end
        
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
        self.metadata = []
        self.index_path = Path(config.vector_db_dir) / "faiss.index"
        self.docs_path = Path(config.vector_db_dir) / "documents.pkl"
        
    def create_index(self, embedding_dim: int):
        """Create FAISS index"""
        if self.config.faiss_index_type == "Flat":
            self.index = faiss.IndexFlatL2(embedding_dim)
        elif self.config.faiss_index_type == "IVF":
            quantizer = faiss.IndexFlatL2(embedding_dim)
            self.index = faiss.IndexIVFFlat(quantizer, embedding_dim, 100)
        else:
            raise ValueError(f"Unknown index type: {self.config.faiss_index_type}")
        
        logger.info(f"Created FAISS index: {self.config.faiss_index_type}")
    
    def add_documents(self, embeddings: np.ndarray, documents: List[Dict]):
        """Add documents to the index"""
        if self.index is None:
            self.create_index(embeddings.shape[1])
        
        # Train index if needed (for IVF)
        if self.config.faiss_index_type == "IVF" and not self.index.is_trained:
            logger.info("Training FAISS index...")
            self.index.train(embeddings)
        
        # Add to index
        self.index.add(embeddings)
        self.documents.extend(documents)
        
        logger.info(f"Added {len(documents)} documents to index. Total: {self.index.ntotal}")
    
    def search(self, query_embedding: np.ndarray, k: int = None) -> List[Dict]:
        """Search for similar documents"""
        if self.index is None or self.index.ntotal == 0:
            logger.warning("Index is empty")
            return []
        
        k = k or self.config.n_neighbors
        k = min(k, self.index.ntotal)
        
        # Reshape for FAISS
        query_embedding = query_embedding.reshape(1, -1)
        
        # Search
        distances, indices = self.index.search(query_embedding, k)
        
        # Prepare results
        results = []
        for i, (dist, idx) in enumerate(zip(distances[0], indices[0])):
            if idx < len(self.documents):
                result = self.documents[idx].copy()
                result["score"] = float(dist)
                result["rank"] = i + 1
                results.append(result)
        
        return results
    
    def save(self):
        """Save index and documents to disk"""
        if self.index is not None:
            logger.info(f"Saving FAISS index to {self.index_path}")
            faiss.write_index(self.index, str(self.index_path))
            
            with open(self.docs_path, 'wb') as f:
                pickle.dump(self.documents, f)
            
            logger.info("Vector store saved successfully")
    
    def load(self):
        """Load index and documents from disk"""
        if self.index_path.exists() and self.docs_path.exists():
            logger.info(f"Loading FAISS index from {self.index_path}")
            self.index = faiss.read_index(str(self.index_path))
            
            with open(self.docs_path, 'rb') as f:
                self.documents = pickle.load(f)
            
            logger.info(f"Loaded index with {self.index.ntotal} vectors")
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
                headers={"Content-Type": "application/json"}
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
        self.vector_store = FAISSVectorStore(self.config)
        self.llm_client = LMStudioClient(self.config)
        
        # Try to load existing index
        self.vector_store.load()
    
    def process_pdf(self, pdf_path: str):
        """Process a single PDF and add to vector store"""
        logger.info(f"Processing PDF: {pdf_path}")
        
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
        
        # Save index
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
                "rank": doc["rank"]
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
        self.vector_store.save()
    
    def clear_index(self):
        """Clear the vector store"""
        self.vector_store.index = None
        self.vector_store.documents = []
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
    
    args = parser.parse_args()
    
    # Initialize RAG pipeline
    config = RAGConfig()
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
        
with open('config.yaml', 'r') as f:
    config_dict = yaml.safe_load(f)
    config = RAGConfig(**config_dict)

if __name__ == "__main__":
    main()
