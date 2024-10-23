--
-- PostgreSQL database dump
--

-- Dumped from database version 17.0 (Debian 17.0-1.pgdg120+1)
-- Dumped by pg_dump version 17.0 (Ubuntu 17.0-1.pgdg22.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: authority_level; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.authority_level AS ENUM (
    'public',
    'private',
    'restricted'
);


ALTER TYPE public.authority_level OWNER TO postgres;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.user_role AS ENUM (
    'student',
    'instructor',
    'course designer',
    'admin'
);


ALTER TYPE public.user_role OWNER TO postgres;

--
-- Name: set_module_order(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_module_order() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Set the next module_order by finding the max module_order for the course and adding 1
    NEW.module_order := COALESCE(
        (SELECT MAX(module_order) FROM module WHERE course_id = NEW.course_id),
        0
    ) + 1;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_module_order() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: course; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.course (
    course_id uuid NOT NULL,
    course_title character varying(255) NOT NULL,
    course_description text,
    creater_id character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    authority public.authority_level DEFAULT 'public'::public.authority_level
);


ALTER TABLE public.course OWNER TO postgres;

--
-- Name: module; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.module (
    module_id uuid NOT NULL,
    module_title character varying(255) NOT NULL,
    course_id uuid,
    module_order integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.module OWNER TO postgres;

--
-- Name: page; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.page (
    page_id uuid NOT NULL,
    slide_id uuid,
    page_number integer NOT NULL,
    text text,
    img_base64 text,
    vector double precision[],
    image_text text
);


ALTER TABLE public.page OWNER TO postgres;

--
-- Name: slide; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.slide (
    id uuid NOT NULL,
    slide_google_id character varying,
    slide_title character varying NOT NULL,
    slide_google_url character varying,
    slide_cover character varying,
    module_id uuid NOT NULL
);


ALTER TABLE public.slide OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id character varying(100) NOT NULL,
    name character varying(100) NOT NULL,
    image character varying(999),
    email character varying(100) NOT NULL,
    role public.user_role
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: course course_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (course_id);


--
-- Name: module module_course_id_module_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.module
    ADD CONSTRAINT module_course_id_module_order_key UNIQUE (course_id, module_order);


--
-- Name: module module_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.module
    ADD CONSTRAINT module_pkey PRIMARY KEY (module_id);


--
-- Name: page page_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page
    ADD CONSTRAINT page_pkey PRIMARY KEY (page_id);


--
-- Name: slide slide_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.slide
    ADD CONSTRAINT slide_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_page_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_page_number ON public.page USING btree (slide_id, page_number);


--
-- Name: idx_page_slide; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_page_slide ON public.page USING btree (slide_id);


--
-- Name: module before_module_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_module_insert BEFORE INSERT ON public.module FOR EACH ROW EXECUTE FUNCTION public.set_module_order();


--
-- Name: course course_creater_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_creater_id_fkey FOREIGN KEY (creater_id) REFERENCES public.users(id);


--
-- Name: module fk_course; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.module
    ADD CONSTRAINT fk_course FOREIGN KEY (course_id) REFERENCES public.course(course_id) ON DELETE CASCADE;


--
-- Name: slide fk_module; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.slide
    ADD CONSTRAINT fk_module FOREIGN KEY (module_id) REFERENCES public.module(module_id) ON DELETE CASCADE;


--
-- Name: page fk_slide_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page
    ADD CONSTRAINT fk_slide_id FOREIGN KEY (slide_id) REFERENCES public.slide(id) ON DELETE CASCADE;


--
-- Name: module module_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.module
    ADD CONSTRAINT module_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id);


--
-- PostgreSQL database dump complete
--

