# 🌱 Gix — A Tiny Git-like CLI Tool

Gix is a minimal version control system built with Node.js. It lets you:

- **init** a repo
- **add** files
- **commit** changes
- **view log**
- **show diffs** between commits

Perfect for learning how Git works under the hood.

## 🚀 Setup

1. Install dependencies:
    ```bash
    npm install
    ```

2. Make the script executable:
    ```bash
    chmod +x gix.mjs
    ```

3. Run it using:
    ```bash
    node gix.mjs <command>
    ```

## 📚 Commands

- `gix init`  
  Initialize a repo.

- `gix add <file>`  
  Stage a file.

- `gix commit "message"`  
  Commit staged files.

- `gix log`  
  Show commit history.

- `gix show <commit-hash>`  
  Show commit diff.

## 💡 Example

```bash
gix init
gix add notes.txt
gix commit "Add notes"
gix log
gix show abc123
```

## 🧠 Why?

To understand how Git-like systems work: hashing, staging, committing, and diffing — all in plain JavaScript.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.
