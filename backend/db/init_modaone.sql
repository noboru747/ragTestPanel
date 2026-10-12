-- 由 backend/scripts/create_modaone_db.sh 自動產生（來源：rga_km schema），請勿手改
-- embedding: vector(1024)（bge-m3），向量索引：HNSW cosine
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Debian 16.14-1.pgdg12+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: document_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_templates (
    id character varying NOT NULL,
    name character varying NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id integer NOT NULL,
    project_id text DEFAULT 'default'::text NOT NULL,
    filename text NOT NULL,
    content text NOT NULL,
    embedding public.vector(1024),
    file_type text,
    tags text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
    doc_version text,
    effective_date date,
    superseded_by integer,
    embedding_stale boolean DEFAULT false NOT NULL
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: generated_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_docs (
    id integer NOT NULL,
    project_id text,
    template_id text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    form_values jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: generated_docs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generated_docs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generated_docs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generated_docs_id_seq OWNED BY public.generated_docs.id;


--
-- Name: mask_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mask_mappings (
    id integer NOT NULL,
    project_id text NOT NULL,
    placeholder text NOT NULL,
    category text NOT NULL,
    original_value text NOT NULL,
    filenames text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: mask_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mask_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mask_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mask_mappings_id_seq OWNED BY public.mask_mappings.id;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    git_url text,
    status text DEFAULT 'active'::text,
    tags text[],
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templates (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    tags text[],
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: generated_docs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_docs ALTER COLUMN id SET DEFAULT nextval('public.generated_docs_id_seq'::regclass);


--
-- Name: mask_mappings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mask_mappings ALTER COLUMN id SET DEFAULT nextval('public.mask_mappings_id_seq'::regclass);


--
-- Name: document_templates document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_templates
    ADD CONSTRAINT document_templates_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: documents documents_project_id_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_project_id_filename_key UNIQUE (project_id, filename);


--
-- Name: generated_docs generated_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_docs
    ADD CONSTRAINT generated_docs_pkey PRIMARY KEY (id);


--
-- Name: mask_mappings mask_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mask_mappings
    ADD CONSTRAINT mask_mappings_pkey PRIMARY KEY (id);


--
-- Name: mask_mappings mask_mappings_project_id_category_original_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mask_mappings
    ADD CONSTRAINT mask_mappings_project_id_category_original_value_key UNIQUE (project_id, category, original_value);


--
-- Name: mask_mappings mask_mappings_project_id_placeholder_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mask_mappings
    ADD CONSTRAINT mask_mappings_project_id_placeholder_key UNIQUE (project_id, placeholder);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: idx_documents_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_embedding ON public.documents USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: idx_documents_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_project ON public.documents USING btree (project_id);


--
-- Name: idx_documents_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_tsv ON public.documents USING gin (content_tsv);


--
-- Name: idx_mask_mappings_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mask_mappings_project ON public.mask_mappings USING btree (project_id);


--
-- Name: documents documents_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.documents(id);


--
-- PostgreSQL database dump complete
--


