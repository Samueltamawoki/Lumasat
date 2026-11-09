-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Tempo de geração: 06/11/2026 às 20:49
-- Versão do servidor: 10.4.32-MariaDB
-- Versão do PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Banco de dados: `lumasat`
--

-- --------------------------------------------------------

--
-- Estrutura para tabela `login`
--

CREATE TABLE `login` (
  `id` int(11) NOT NULL,
  `email` varchar(100) NOT NULL,
  `senha` varchar(255) NOT NULL,
  `nome` varchar(255) NOT NULL,
  `confirmarSenha` varchar(255) NOT NULL,
  `empresa` varchar(100) DEFAULT NULL,
  `nivel` varchar(20) DEFAULT 'operador'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Despejando dados para a tabela `login`
--

INSERT INTO `login` (`id`, `email`, `senha`, `nome`, `confirmarSenha`, `empresa`, `nivel`) VALUES
(1, 'admin@email.com', '123456', '', '', 'Empresa Alfa', 'Supervisor'),
(10, 'rafaelaxaviereu@gmail.com', '123', 'lucas', '123', NULL, 'operador'),
(12, 'samuel@gmail.com', '123', 'samuel henry', '123', NULL, 'operador'),
(13, 'maria@gmail.com', '123', 'maria luiza amorim ruas barbosa', '123', NULL, 'operador'),
(14, 'lucas.campos51@senaisp.edu.br', '123', 'lucas', '123', NULL, 'operador'),
(15, 'lucas@gmail.com', '123456', 'lucas', '123456', NULL, 'operador'),
(16, 'samuel@gmail.com', '123456', 'samuel henry tamawoki', '123456', NULL, 'operador'),
(18, 'henry@gmail.com', '123456', 'samuel henry tamawoki', '', 'Empresa Alfa', 'operador'),
(19, 'malu@gmail.com', '123456', 'Maria Luiza ', '', 'Empresa Beta', 'operador'),
(20, 'ren@gmail.com', '123456', 'Curco', '', 'Curco company', 'operador'),
(21, 'pablo@gmail.com', '123456', 'pablo augusto chagas ', '', 'Empresa Alfa', 'Supervisor');

--
-- Índices para tabelas despejadas
--

--
-- Índices de tabela `login`
--
ALTER TABLE `login`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT para tabelas despejadas
--

--
-- AUTO_INCREMENT de tabela `login`
--
ALTER TABLE `login`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=22;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
